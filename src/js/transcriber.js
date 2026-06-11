/**
 * transcriber.js — Whisper-based audio transcription using transformers.js v3
 * Uses onnx-community/whisper-base (multilingual) for English, Hindi & Hinglish support.
 * Chunk-level timestamps + word-level approximation.
 */
import { pipeline } from '@huggingface/transformers';
import { extractAudioForWhisper } from './audio-extractor.js';

let transcriber = null;
let loadedModelId = null;

/**
 * Get the right model ID based on language
 * English uses .en model (faster, more accurate for pure English)
 * Hindi/Hinglish use multilingual model
 */
function getModelId(language) {
  if (language === 'hi' || language === 'hinglish') {
    return 'onnx-community/whisper-base';
  }
  return 'onnx-community/whisper-base.en';
}

/**
 * Transcribe a video file using Whisper
 * @param {File} videoFile
 * @param {Function} onProgress - (stage, percent, message)
 * @param {string} language - 'en', 'hi', or 'hinglish'
 * @returns {Promise<{ text: string, chunks: Array<{ text: string, timestamp: [number, number] }> }>}
 */
export async function transcribeVideo(videoFile, onProgress, language = 'en') {
  try {
    // Phase 1: Extract audio
    onProgress('extract', 0, 'Extracting audio from video...');
    const audioBlob = await extractAudioForWhisper(videoFile, (msg) => {
      onProgress('extract', 50, `FFmpeg: ${msg}`);
    });
    onProgress('extract', 100, 'Audio extracted ✓');

    // Phase 2: Load Whisper model
    const modelId = getModelId(language);
    const langLabel = language === 'hi' ? 'Hindi' : language === 'hinglish' ? 'Hinglish' : 'English';
    onProgress('model', 0, `Loading Whisper model (${langLabel})...`);

    // Reload model if language changed (en vs multilingual)
    if (!transcriber || loadedModelId !== modelId) {
      transcriber = await pipeline(
        'automatic-speech-recognition',
        modelId,
        {
          dtype: 'fp32',
          device: 'wasm',
          progress_callback: (progress) => {
            if (progress.status === 'progress' && progress.progress) {
              onProgress('model', Math.round(progress.progress), `Downloading model: ${Math.round(progress.progress)}%`);
            }
          },
        }
      );
      loadedModelId = modelId;
    }
    onProgress('model', 100, 'Whisper model loaded ✓');

    // Phase 3: Transcribe with chunk-level timestamps
    onProgress('transcribe', 0, `Transcribing audio (${langLabel})...`);
    const audioUrl = URL.createObjectURL(audioBlob);

    // Build transcription options
    const transcribeOptions = {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    };

    // Set language for multilingual model
    if (language === 'hi') {
      transcribeOptions.language = 'hindi';
      transcribeOptions.task = 'transcribe';
    } else if (language === 'hinglish') {
      // For Hinglish: use Hindi language setting — Whisper handles English words within Hindi
      transcribeOptions.language = 'hindi';
      transcribeOptions.task = 'transcribe';
    }
    // For 'en' with .en model, no language param needed

    const result = await transcriber(audioUrl, transcribeOptions);

    URL.revokeObjectURL(audioUrl);

    // Convert chunk-level to word-level approximation
    onProgress('transcribe', 80, 'Processing word timestamps...');
    const wordChunks = chunksToWords(result.chunks || []);

    onProgress('transcribe', 100, `Transcription complete ✓ (${wordChunks.length} words)`);

    const fullText = wordChunks.map(c => c.text).join(' ');

    return {
      text: fullText,
      chunks: wordChunks,
    };
  } catch (err) {
    console.error('Transcription error:', err);
    throw new Error(`Transcription failed: ${err.message}`);
  }
}

/**
 * Convert chunk-level timestamps to approximate word-level timestamps.
 * Distributes time proportionally by character count with small gaps between words.
 */
function chunksToWords(chunks) {
  const wordChunks = [];

  for (const chunk of chunks) {
    const text = (chunk.text || '').trim();
    if (!text) continue;

    const start = chunk.timestamp?.[0] ?? 0;
    const end = chunk.timestamp?.[1] ?? start;
    const duration = end - start;

    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    const totalChars = words.reduce((sum, w) => sum + Math.max(w.length, 1), 0);
    const avgWordDuration = duration / words.length;
    const wordGap = Math.min(0.05, avgWordDuration * 0.05);
    const usableDuration = duration - (wordGap * (words.length - 1));

    let currentTime = start;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const wordDuration = (Math.max(word.length, 1) / totalChars) * usableDuration;
      const wordStart = currentTime;
      const wordEnd = currentTime + wordDuration;

      wordChunks.push({
        text: word,
        timestamp: [
          Math.round(wordStart * 100) / 100,
          Math.round(wordEnd * 100) / 100,
        ],
      });

      currentTime = wordEnd + wordGap;
    }
  }

  return wordChunks;
}
