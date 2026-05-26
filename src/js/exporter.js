/**
 * exporter.js — WebCodecs MP4 export engine
 * Exports composed canvas frames + audio as MP4 using WebCodecs + mp4-muxer
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { extractAudioSegment } from './audio-extractor.js';

/**
 * Get the appropriate H.264 codec string based on resolution
 */
function getCodecForResolution(width, height) {
  const area = width * height;
  if (area > 2_088_960) return 'avc1.640033'; // High 5.1
  if (area > 921_600) return 'avc1.640028';   // High 4.0
  return 'avc1.42001f';                        // Baseline 3.1
}

/**
 * Export a single clip as MP4 with audio
 * @param {HTMLVideoElement} videoElement
 * @param {File} videoFile - Original video file (for audio extraction)
 * @param {{ start_time: number, end_time: number, hook_text: string }} clip
 * @param {Array<{ text: string, timestamp: [number, number] }>} wordChunks
 * @param {import('./composer.js').Composer} composer
 * @param {{ width: number, height: number, fps?: number, bitrate?: number }} options
 * @param {Function} onProgress - (percent, message)
 * @returns {Promise<Blob>} MP4 video blob
 */
export async function exportClip(videoElement, videoFile, clip, wordChunks, composer, options, onProgress) {
  const fps = options.fps || 30;
  const bitrate = options.bitrate || 5_000_000;
  const width = options.width || 1080;
  const height = options.height || 1920;
  const duration = clip.end_time - clip.start_time;
  const totalFrames = Math.ceil(duration * fps);
  const codec = getCodecForResolution(width, height);

  onProgress(0, 'Setting up encoder...');

  // Check WebCodecs support
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('WebCodecs not supported. Please use Chrome 94+ or Edge 94+.');
  }

  // Check codec support
  const support = await VideoEncoder.isConfigSupported({
    codec, width, height, bitrate, framerate: fps,
  });
  if (!support.supported) {
    throw new Error(`Codec ${codec} at ${width}x${height} is not supported by this browser.`);
  }

  // Phase 1: Extract audio in parallel while we set up video
  onProgress(2, 'Extracting audio...');
  let audioBuffer = null;
  try {
    const audioArrayBuffer = await extractAudioSegment(videoFile, clip.start_time, clip.end_time);
    const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    audioBuffer = await audioContext.decodeAudioData(audioArrayBuffer);
    audioContext.close();
    onProgress(10, 'Audio extracted ✓');
  } catch (err) {
    console.warn('Audio extraction failed, exporting video-only:', err);
    onProgress(10, 'Audio failed, continuing video-only...');
  }

  // Phase 2: Create muxer (with or without audio)
  const target = new ArrayBufferTarget();
  const muxerConfig = {
    target,
    video: { codec: 'avc', width, height },
    fastStart: 'in-memory',
  };

  if (audioBuffer) {
    muxerConfig.audio = {
      codec: 'aac',
      numberOfChannels: 1,
      sampleRate: audioBuffer.sampleRate,
    };
  }

  const muxer = new Muxer(muxerConfig);

  // Phase 3: Encode audio first (if available)
  if (audioBuffer) {
    onProgress(12, 'Encoding audio...');
    try {
      await encodeAudioToMuxer(audioBuffer, muxer);
      onProgress(18, 'Audio encoded ✓');
    } catch (err) {
      console.warn('Audio encoding failed:', err);
    }
  }

  // Phase 4: Encode video frames
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (err) => {
      console.error('VideoEncoder error:', err);
    },
  });

  videoEncoder.configure({
    codec, width, height, bitrate, framerate: fps,
    latencyMode: 'quality',
  });

  onProgress(20, 'Rendering frames...');

  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
    const frameTime = clip.start_time + (frameIdx / fps);
    const progress = 20 + Math.round((frameIdx / totalFrames) * 70);

    // Seek video to frame time
    await seekVideo(videoElement, frameTime);

    // Render composition
    composer.renderFrame(videoElement, frameTime, clip, wordChunks);

    // Create and encode VideoFrame
    const frame = new VideoFrame(composer.canvas, {
      timestamp: Math.round((frameIdx / fps) * 1_000_000),
      duration: Math.round(1_000_000 / fps),
    });

    const isKeyframe = frameIdx % (fps * 2) === 0;
    videoEncoder.encode(frame, { keyFrame: isKeyframe });
    frame.close();

    // Update progress and yield to UI
    if (frameIdx % 5 === 0) {
      onProgress(progress, `Frame ${frameIdx + 1} / ${totalFrames}`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // Flush and close
  onProgress(92, 'Finalizing video...');
  await videoEncoder.flush();
  videoEncoder.close();

  // Finalize MP4
  onProgress(96, 'Writing MP4...');
  muxer.finalize();

  const blob = new Blob([target.buffer], { type: 'video/mp4' });
  onProgress(100, 'Export complete! ✓');

  return blob;
}

/**
 * Encode decoded audio buffer to AAC and add to muxer
 */
async function encodeAudioToMuxer(audioBuffer, muxer) {
  if (typeof AudioEncoder === 'undefined') {
    console.warn('AudioEncoder not available');
    return;
  }

  const channelData = audioBuffer.getChannelData(0); // Mono
  const sampleRate = audioBuffer.sampleRate;

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => {
      muxer.addAudioChunk(chunk, meta);
    },
    error: (err) => console.error('AudioEncoder error:', err),
  });

  audioEncoder.configure({
    codec: 'mp4a.40.2',
    numberOfChannels: 1,
    sampleRate: sampleRate,
    bitrate: 128000,
  });

  // Encode in chunks of 1024 samples (AAC frame size)
  const chunkSize = 1024;
  for (let i = 0; i < channelData.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, channelData.length);
    const frameCount = end - i;

    // Need exactly chunkSize samples for the last frame, pad with zeros
    const samples = new Float32Array(chunkSize);
    samples.set(channelData.subarray(i, end));

    const data = new AudioData({
      format: 'f32',
      sampleRate: sampleRate,
      numberOfFrames: chunkSize,
      numberOfChannels: 1,
      timestamp: Math.round((i / sampleRate) * 1_000_000),
      data: samples,
    });

    audioEncoder.encode(data);
    data.close();
  }

  await audioEncoder.flush();
  audioEncoder.close();
}

/**
 * Seek video element to a specific time and wait
 */
function seekVideo(videoElement, time) {
  return new Promise((resolve) => {
    if (Math.abs(videoElement.currentTime - time) < 0.02) {
      resolve();
      return;
    }
    const onSeeked = () => {
      videoElement.removeEventListener('seeked', onSeeked);
      resolve();
    };
    videoElement.addEventListener('seeked', onSeeked);
    videoElement.currentTime = time;
    setTimeout(resolve, 500); // Timeout fallback
  });
}

/**
 * Download a blob as a file
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
