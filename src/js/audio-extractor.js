/**
 * audio-extractor.js — FFmpeg.wasm singleton + audio extraction
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpegInstance = null;
let ffmpegLoading = false;
let ffmpegLoadPromise = null;

/**
 * Get the singleton FFmpeg instance, loading it if necessary.
 * @param {Function} [onLog] - Optional log callback
 * @returns {Promise<FFmpeg>}
 */
export async function getFFmpeg(onLog) {
  if (ffmpegInstance && ffmpegInstance.loaded) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    ffmpegLoading = true;
    const ffmpeg = new FFmpeg();

    if (onLog) {
      ffmpeg.on('log', ({ message }) => onLog(message));
    }

    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    ffmpegInstance = ffmpeg;
    ffmpegLoading = false;
    return ffmpeg;
  })();

  return ffmpegLoadPromise;
}

/**
 * Extract full audio as 16kHz mono WAV for Whisper
 * @param {File} videoFile
 * @param {Function} [onLog]
 * @returns {Promise<Blob>} WAV audio blob
 */
export async function extractAudioForWhisper(videoFile, onLog) {
  const ffmpeg = await getFFmpeg(onLog);

  const inputName = 'input_video' + getExt(videoFile.name);
  await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

  await ffmpeg.exec([
    '-i', inputName,
    '-ar', '16000',
    '-ac', '1',
    '-f', 'wav',
    '-y',
    'audio_full.wav',
  ]);

  const data = await ffmpeg.readFile('audio_full.wav');
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile('audio_full.wav');

  return new Blob([data.buffer], { type: 'audio/wav' });
}

/**
 * Extract an audio segment as WAV for a clip
 * WAV is used because AudioContext.decodeAudioData can always decode it.
 * @param {File} videoFile
 * @param {number} startTime - Start in seconds
 * @param {number} endTime - End in seconds
 * @param {Function} [onLog]
 * @returns {Promise<ArrayBuffer>} WAV audio data as ArrayBuffer
 */
export async function extractAudioSegment(videoFile, startTime, endTime, onLog) {
  const ffmpeg = await getFFmpeg(onLog);

  const inputName = 'seg_input' + getExt(videoFile.name);
  const outputName = `seg_audio_${Date.now()}.wav`;

  await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

  await ffmpeg.exec([
    '-i', inputName,
    '-ss', String(startTime),
    '-to', String(endTime),
    '-vn',
    '-ar', '44100',
    '-ac', '1',
    '-f', 'wav',
    '-y',
    outputName,
  ]);

  const data = await ffmpeg.readFile(outputName);
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  // Return as ArrayBuffer for AudioContext.decodeAudioData
  return data.buffer;
}

function getExt(filename) {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.substring(dot) : '.mp4';
}
