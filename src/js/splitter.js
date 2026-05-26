/**
 * splitter.js — Fallback clip splitter (no AI, uses heuristics)
 * Generates 3-5 short clips of 6-12 seconds each.
 */

/**
 * Split transcript into clips using silence detection and sentence boundaries
 * @param {Array<{ text: string, timestamp: [number, number] }>} chunks - Word-level transcript
 * @param {number} totalDuration - Total video duration in seconds
 * @param {number} [targetCount=5] - Target number of clips
 * @returns {Array<{ start_time: number, end_time: number, hook_text: string, reason: string }>}
 */
export function splitTranscript(chunks, totalDuration, targetCount = 5) {
  if (!chunks || chunks.length === 0) {
    return splitEvenlyByTime(totalDuration, targetCount);
  }

  // Find natural break points (sentence ends, pauses)
  const breakPoints = findBreakPoints(chunks);

  // Build clips using break points
  const clips = buildClips(chunks, breakPoints, totalDuration, targetCount);

  // If heuristics failed, fall back to even splitting
  if (clips.length < 2) {
    return splitEvenlyByTime(totalDuration, Math.max(targetCount, 3));
  }

  return clips;
}

/**
 * Find natural break points in the transcript
 */
function findBreakPoints(chunks) {
  const breaks = [];

  for (let i = 0; i < chunks.length - 1; i++) {
    const current = chunks[i];
    const next = chunks[i + 1];
    const currentEnd = current.timestamp?.[1] ?? 0;
    const nextStart = next.timestamp?.[0] ?? 0;
    const gap = nextStart - currentEnd;

    let score = 0;
    let type = 'word';

    // Silence gap scoring
    if (gap > 1.5) {
      score += 5;
      type = 'long-pause';
    } else if (gap > 0.8) {
      score += 3;
      type = 'pause';
    } else if (gap > 0.3) {
      score += 1;
    }

    // Sentence boundary scoring
    const word = current.text.trim();
    if (word.endsWith('.') || word.endsWith('!') || word.endsWith('?')) {
      score += 4;
      type = 'sentence';
    } else if (word.endsWith(',') || word.endsWith(';') || word.endsWith(':')) {
      score += 2;
    }

    if (score >= 1) {
      breaks.push({
        index: i,
        time: currentEnd,
        score,
        type,
      });
    }
  }

  return breaks;
}

/**
 * Build clips by walking through break points and cutting at ideal durations
 */
function buildClips(chunks, breakPoints, totalDuration, targetCount) {
  const minDuration = 6;
  const maxDuration = 12;
  const idealDuration = 8;

  const firstStart = chunks[0]?.timestamp?.[0] ?? 0;
  const lastEnd = chunks[chunks.length - 1]?.timestamp?.[1] ?? totalDuration;

  // If video is very short, return as single clip
  if (lastEnd - firstStart <= maxDuration) {
    return [{
      start_time: Math.max(0, firstStart - 0.3),
      end_time: Math.min(totalDuration, lastEnd + 0.3),
      hook_text: generateHookText(chunks, 0, chunks.length - 1),
      reason: 'Full segment',
    }];
  }

  // Sort break points by time
  const sortedBreaks = [...breakPoints].sort((a, b) => a.time - b.time);

  const clips = [];
  let segStart = firstStart;
  let segStartIdx = 0;

  // Walk through all break points looking for good cut points
  for (let bi = 0; bi < sortedBreaks.length; bi++) {
    const bp = sortedBreaks[bi];
    const elapsed = bp.time - segStart;

    // Too short — keep going
    if (elapsed < minDuration) continue;

    // In the sweet spot or exceeded max — cut here
    if (elapsed >= minDuration && (elapsed >= idealDuration || elapsed > maxDuration || bp.score >= 4)) {
      clips.push({
        start_time: Math.max(0, segStart - 0.2),
        end_time: Math.min(totalDuration, bp.time + 0.2),
        hook_text: generateHookText(chunks, segStartIdx, bp.index),
        reason: `Natural ${bp.type} break`,
      });

      // Move start to next word
      segStart = chunks[bp.index + 1]?.timestamp?.[0] ?? bp.time;
      segStartIdx = bp.index + 1;

      // Stop if we have enough clips
      if (clips.length >= targetCount) break;
    }
  }

  // Handle remainder — if there's enough left, make one more clip
  if (clips.length < targetCount && segStart < lastEnd) {
    const remaining = lastEnd - segStart;
    if (remaining >= minDuration) {
      clips.push({
        start_time: Math.max(0, segStart - 0.2),
        end_time: Math.min(totalDuration, Math.min(segStart + maxDuration, lastEnd) + 0.2),
        hook_text: generateHookText(chunks, segStartIdx, chunks.length - 1),
        reason: 'Final segment',
      });
    }
  }

  return clips;
}

function splitEvenlyByTime(totalDuration, count) {
  const clipDuration = Math.min(9, totalDuration / count);
  const clips = [];
  const actualCount = Math.max(count, Math.floor(totalDuration / clipDuration));

  for (let i = 0; i < actualCount && clips.length < count; i++) {
    const start = i * clipDuration;
    const end = Math.min(start + clipDuration, totalDuration);
    if (end - start >= 5) {
      clips.push({
        start_time: start,
        end_time: end,
        hook_text: `Part ${i + 1} 🔥`,
        reason: 'Even time split',
      });
    }
  }

  return clips;
}

function generateHookText(chunks, startIdx, endIdx) {
  const words = [];
  for (let i = startIdx; i <= Math.min(endIdx, startIdx + 5); i++) {
    if (chunks[i]?.text) {
      words.push(chunks[i].text.trim());
    }
  }
  const text = words.join(' ').replace(/[.,!?;:]$/g, '');
  if (!text) return 'Watch this 🔥';
  return text.length > 35 ? text.substring(0, 35) + '... 🔥' : text + ' 🔥';
}
