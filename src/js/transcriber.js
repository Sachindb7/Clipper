/**
 * transcriber.js — Whisper-based audio transcription using transformers.js v3
 * Uses onnx-community/whisper-base.en for better accuracy,
 * with chunk-level timestamps + improved word-level approximation.
 */
import { pipeline } from '@huggingface/transformers';
import { extractAudioForWhisper } from './audio-extractor.js';

let transcriber = null;

/**
 * Transcribe a video file using Whisper (base.en model — 2x more accurate than tiny)
 * @param {File} videoFile
 * @param {Function} onProgress - (stage, percent, message)
 * @returns {Promise<{ text: string, chunks: Array<{ text: string, timestamp: [number, number] }> }>}
 */
export async function transcribeVideo(videoFile, onProgress) {
  try {
    // Phase 1: Extract audio
    onProgress('extract', 0, 'Extracting audio from video...');
    const audioBlob = await extractAudioForWhisper(videoFile, (msg) => {
      onProgress('extract', 50, `FFmpeg: ${msg}`);
    });
    onProgress('extract', 100, 'Audio extracted ✓');

    // Phase 2: Load Whisper model (base.en = much better accuracy than tiny.en)
    onProgress('model', 0, 'Loading Whisper AI model (first time may take a moment)...');
    if (!transcriber) {
      transcriber = await pipeline(
        'automatic-speech-recognition',
        'onnx-community/whisper-base.en',
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
    }
    onProgress('model', 100, 'Whisper model loaded ✓');

    // Phase 3: Transcribe with word-level timestamps first, fall back to chunk-level
    onProgress('transcribe', 0, 'Transcribing audio...');
    const audioUrl = URL.createObjectURL(audioBlob);

    let wordChunks;

    // Try word-level timestamps first (most accurate)
    try {
      const result = await transcriber(audioUrl, {
        return_timestamps: 'word',
        chunk_length_s: 30,
        stride_length_s: 5,
      });

      // Check if we got proper word-level timestamps
      if (result.chunks && result.chunks.length > 0 && result.chunks[0].timestamp) {
        wordChunks = result.chunks
          .filter(c => c.text && c.text.trim())
          .map(c => ({
            text: c.text.trim(),
            timestamp: [
              Math.round((c.timestamp[0] ?? 0) * 100) / 100,
              Math.round((c.timestamp[1] ?? 0) * 100) / 100,
            ],
          }));

        if (wordChunks.length > 0) {
          onProgress('transcribe', 80, `Word-level timestamps ✓ (${wordChunks.length} words)`);
        }
      }
    } catch (wordErr) {
      console.warn('Word-level timestamps not available, falling back to chunk-level:', wordErr.message);
    }

    // Fallback: chunk-level timestamps with word approximation
    if (!wordChunks || wordChunks.length === 0) {
      onProgress('transcribe', 40, 'Using chunk-level timestamps...');
      const result = await transcriber(audioUrl, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      });

      wordChunks = chunksToWords(result.chunks || []);
    }

    URL.revokeObjectURL(audioUrl);

    onProgress('transcribe', 100, `Transcription complete ✓ (${wordChunks.length} words)`);

    // Build full text
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
 * @param {Array<{ text: string, timestamp: [number, number] }>} chunks
 * @returns {Array<{ text: string, timestamp: [number, number] }>}
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

    // Distribute time proportionally by word length (longer words ≈ more time)
    const totalChars = words.reduce((sum, w) => sum + Math.max(w.length, 1), 0);
    // Small gap between words (5% of average word duration)
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
