/**
 * gemini-analyzer.js — Gemini viral moment detection with model fallback chain
 * Tries best models first, falls back to more reliable ones.
 */

// ============ Model Fallback Chain ============
// Tries in order: best → most reliable
const MODEL_FALLBACK_CHAIN = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

// Codenames for console logs (don't expose model names to users)
const MODEL_CODENAMES = {
  'gemini-3.5-flash': 'Engine-A',
  'gemini-3.1-flash-lite': 'Engine-B',
  'gemini-2.5-flash': 'Engine-C',
  'gemini-2.5-flash-lite': 'Engine-D',
};

const RETRIES_PER_MODEL = 2;
const RETRY_DELAY_MS = 3000;
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const SYSTEM_PROMPT = `You are a VIRAL CONTENT GENIUS — the #1 social media strategist in the world. Your job: extract MULTIPLE short clips from a video transcript for Instagram Reels / TikToks / YouTube Shorts.

ABSOLUTE REQUIREMENTS (VIOLATION = FAILURE):
1. You MUST return AT LEAST 3 clips, ideally 4-5. Returning fewer than 3 is UNACCEPTABLE.
2. Each clip MUST be 6-12 seconds long. Target 7-9 seconds. NEVER exceed 12 seconds.
3. Each clip captures ONE complete thought, reaction, or quotable moment.
4. Never cut mid-sentence. Each clip must make sense standalone.
5. Clips must NOT overlap with each other.
6. Spread clips across the ENTIRE transcript — don't cluster them at the start.

What makes a clip VIRAL:
- Extreme emotional reactions (shock, laughter, anger, excitement)
- Controversial or hot-take opinions  
- Funny one-liners or quotable moments
- Dramatic reveals or "wait what?!" moments
- Relatable struggles or situations
- Unexpected plot twists in conversation
- Even calm but profound/wise statements work

══════════════════════════════════════════════════
HOOK TEXT — THE SINGLE MOST IMPORTANT THING YOU DO
══════════════════════════════════════════════════

The hook text appears at TOP of the reel. It decides if people WATCH or SCROLL AWAY.
A great hook doesn't just get clicks — it HITS A NERVE. It makes people FEEL something.
It creates RETENTION (they watch till the end), CONNECTION (they like/share), and EMOTION (they remember it).

The hook "Streamers are humans too 💔" went viral because it didn't clickbait — it HIT A NERVE. 
People connected emotionally. Streamers shared it. Chat members felt called out. THAT is a great hook.

════════════════════════════
THE 5 HOOK STYLES — USE ALL OF THEM
════════════════════════════

Each clip MUST use a DIFFERENT hook style. Do NOT repeat the same style twice.
Pick the style that MATCHES the clip's actual content/emotion:

1. 💔 EMOTIONAL CONNECTION (makes people FEEL something deeply)
   → Use when the clip has real emotion, vulnerability, frustration, or heart
   → Examples: "Streamers are humans too 💔", "Nobody checks on the strong ones 😔💯", "This shouldn't hurt this much 💔😭"
   → WHY IT WORKS: People share because they RELATE. They tag friends. They comment their own stories.

2. 👀 CURIOSITY / CLIFFHANGER (makes people NEED to see what happens)
   → Use ONLY when the clip genuinely has a surprising moment, reveal, or unexpected turn
   → Examples: "Watch what happens next 👀🔥", "Nobody expected this 😱", "The ending tho... 👀💀"
   → ⚠️ NEVER use this style if the clip has NO actual payoff. Fake cliffhangers = instant scroll.

3. 🔥 BOLD / CONTROVERSIAL (makes people DEBATE in comments)
   → Use when someone says something spicy, a hot take, or an unpopular opinion
   → Examples: "He really said that on stream 🫢🔥", "This take is TOO real 💯🔥", "Not everyone's gonna agree 🤷‍♂️🔥"
   → WHY IT WORKS: Controversy = comments = algorithm pushes it to more people.

4. 😂 RELATABLE / FUNNY (makes people tag their friends)
   → Use when the clip has humor, a funny moment, or a universal experience everyone knows
   → Examples: "We've ALL been here 😂💀", "Why is this so accurate 😭😂", "Every gamer knows this pain 🎮💀"
   → WHY IT WORKS: People tag friends saying "this is literally you 😂"

5. 🤯 HYPE / IMPRESSIVE (makes people say "yooo that's insane")
   → Use when the clip has an amazing play, crazy fact, impressive skill, or mind-blowing moment
   → Examples: "This is actually insane 🤯🔥", "How is this even possible 😱", "Nobody does it like this 👑🔥"
   → WHY IT WORKS: People save the video, share in group chats.

═════════════════════
CRITICAL HOOK RULES
═════════════════════

1. MATCH the hook to the clip's REAL emotion. If clip is sad → emotional hook. If clip is funny → funny hook.
2. Every clip gets a DIFFERENT hook style. If clip 1 is emotional, clip 2 must be different (curiosity, bold, etc.)
3. 3-7 words MAX (excluding emojis). Shorter = more powerful.
4. MUST include 2-3 relevant emojis that match the emotion.
5. Don't just DESCRIBE what happens. Make people FEEL something.
6. The hook should be something a REAL person would type, not a robot. Think Instagram comments, not news headlines.
7. Don't repeat the exact words from the clip. Capture the FEELING, not the sentence.

FORBIDDEN (instant fail):
❌ Generic clickbait that doesn't match the content
❌ "[Person name] talks about [topic]" — boring, descriptive
❌ "Discussion about [topic]" — sounds like a podcast title
❌ Fake cliffhangers on clips with no payoff
❌ Same hook style on every clip

REMEMBER: MINIMUM 3 CLIPS, ideally 4-5. SHORT clips (7-9 seconds). Each hook must be a DIFFERENT style that matches the clip's actual emotion.

Respond with ONLY a raw JSON array, NO markdown, NO code blocks, NO backticks.
In "hook_style" field, specify which of the 5 styles you used (emotional/curiosity/bold/relatable/hype):
[{"start_time": 5.2, "end_time": 13.1, "hook_text": "Streamers are humans too 💔", "hook_style": "emotional", "reason": "Vulnerable moment about hate in chat"}]`;


// ============ Retry Helpers ============

function isRetryableError(error) {
  const message = (error?.message || error?.toString() || '').toLowerCase();
  return (
    message.includes('503') ||
    message.includes('429') ||
    message.includes('unavailable') ||
    message.includes('resource_exhausted') ||
    message.includes('overloaded') ||
    message.includes('high demand') ||
    message.includes('rate limit') ||
    message.includes('quota') ||
    message.includes('internal')
  );
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============ Core API Call with Fallback ============

/**
 * Call Gemini API with model fallback chain — tries best models first
 * @param {string} apiKey
 * @param {string} userPrompt
 * @param {Function} [onLog] - optional logging callback
 * @returns {Promise<string>} Raw response text
 */
async function callGeminiWithFallback(apiKey, userPrompt, onLog) {
  let lastError = null;

  for (const model of MODEL_FALLBACK_CHAIN) {
    const codename = MODEL_CODENAMES[model] || model;

    for (let attempt = 1; attempt <= RETRIES_PER_MODEL; attempt++) {
      try {
        if (onLog) onLog(`🤖 ${codename} (attempt ${attempt}/${RETRIES_PER_MODEL})...`);
        console.log(`🤖 Trying ${codename} (${attempt}/${RETRIES_PER_MODEL})`);

        const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: userPrompt }],
              },
            ],
            generationConfig: {
              temperature: 0.4,
              topP: 0.95,
              maxOutputTokens: 4096,
              responseMimeType: 'application/json',
            },
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData?.error?.message || `HTTP ${response.status}`;
          throw new Error(errMsg);
        }

        const data = await response.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawText) {
          throw new Error('Empty response from model');
        }

        console.log(`✅ ${codename} succeeded`);
        if (onLog) onLog(`✅ ${codename} responded!`);
        return rawText;

      } catch (error) {
        lastError = error;
        console.warn(`⚠️ ${codename} attempt ${attempt} failed:`, error.message);

        if (!isRetryableError(error)) {
          // Non-retryable error (e.g., invalid key, bad request) — skip to next model
          if (onLog) onLog(`⚠️ ${codename} error, trying next engine...`);
          break;
        }

        if (attempt < RETRIES_PER_MODEL) {
          if (onLog) onLog(`⏳ Retrying in ${RETRY_DELAY_MS / 1000}s...`);
          await sleep(RETRY_DELAY_MS);
        }
      }
    }
    console.log(`🔄 Switching from ${codename} to next engine...`);
  }

  // All models exhausted
  throw new Error(
    `All AI engines busy. Please wait 2-3 minutes and try again. Last error: ${lastError?.message}`
  );
}

// ============ Main Export ============

/**
 * Analyze transcript with Gemini to find viral moments
 * Uses model fallback chain for reliability
 * @param {{ text: string, chunks: Array<{ text: string, timestamp: [number, number] }> }} transcript
 * @param {string} apiKey - Gemini API key
 * @param {Function} [onLog] - optional progress callback
 * @returns {Promise<Array<{ start_time: number, end_time: number, hook_text: string, reason: string }> | null>}
 */
export async function analyzeTranscript(transcript, apiKey, onLog) {
  if (!apiKey || !apiKey.trim()) {
    console.warn('No Gemini API key provided');
    return null;
  }

  try {
    const formattedTranscript = formatTranscriptForGemini(transcript);
    const totalDuration = Math.round(
      transcript.chunks[transcript.chunks.length - 1]?.timestamp?.[1] || 0
    );

    const userPrompt = `${SYSTEM_PROMPT}

--- TRANSCRIPT WITH TIMESTAMPS ---
${formattedTranscript}
--- END TRANSCRIPT ---

Total video duration: ${totalDuration} seconds.

IMPORTANT FINAL REMINDER: You MUST return AT LEAST 3 clips, ideally 4-5. Each clip 6-12 seconds. Return ONLY a JSON array. Do NOT return just 1 or 2 clips — that is UNACCEPTABLE. Find AT LEAST 3 interesting moments spread across the entire video.`;

    const rawText = await callGeminiWithFallback(apiKey, userPrompt, onLog);
    console.log('Gemini raw response:', rawText);

    // Parse JSON from response
    const clips = parseJsonFromResponse(rawText);

    if (!clips || !Array.isArray(clips) || clips.length === 0) {
      console.error('Could not parse clips from Gemini response:', rawText);
      return null;
    }

    // Validate and clean up clips
    const validClips = clips
      .filter((c) => {
        return (
          typeof c.start_time === 'number' &&
          typeof c.end_time === 'number' &&
          c.start_time < c.end_time &&
          c.end_time - c.start_time >= 3 &&
          c.end_time - c.start_time <= 60 &&
          typeof c.hook_text === 'string'
        );
      })
      .sort((a, b) => a.start_time - b.start_time)
      .map((c) => ({
        start_time: Math.round(c.start_time * 100) / 100,
        end_time: Math.round(c.end_time * 100) / 100,
        hook_text: c.hook_text.trim(),
        reason: c.reason || 'Engaging moment',
      }));

    console.log('Validated clips:', validClips);
    return validClips.length > 0 ? validClips : null;
  } catch (err) {
    console.error('Gemini analysis failed:', err);
    if (onLog) onLog(`⚠️ AI analysis error: ${err.message}`);
    return null;
  }
}

// ============ Helpers ============

function formatTranscriptForGemini(transcript) {
  if (!transcript.chunks || transcript.chunks.length === 0) {
    return transcript.text || '';
  }

  // Group words into sentence-like lines (~10 words each) so Gemini sees coherent context
  const lines = [];
  let currentWords = [];
  let lineStart = transcript.chunks[0]?.timestamp?.[0] ?? 0;

  for (let i = 0; i < transcript.chunks.length; i++) {
    const chunk = transcript.chunks[i];
    const word = chunk.text?.trim();
    if (!word) continue;

    currentWords.push(word);

    const isSentenceEnd = /[.!?]$/.test(word);
    const isLongEnough = currentWords.length >= 10;
    const isLast = i === transcript.chunks.length - 1;

    if (isSentenceEnd || isLongEnough || isLast) {
      const lineEnd = chunk.timestamp?.[1] ?? lineStart;
      const text = currentWords.join(' ');
      lines.push(`[${lineStart.toFixed(1)}s - ${lineEnd.toFixed(1)}s] ${text}`);
      currentWords = [];
      lineStart = transcript.chunks[i + 1]?.timestamp?.[0] ?? lineEnd;
    }
  }

  return lines.join('\n');
}

function parseJsonFromResponse(text) {
  let cleaned = text.trim();

  // 1. Try parsing as-is
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : null;
  } catch {}

  // 2. Remove markdown code fences
  cleaned = cleaned
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : null;
  } catch {}

  // 3. Find the LARGEST JSON array in the text
  const arrayRegex = /\[[\s\S]*\]/g;
  let match;
  let bestMatch = null;
  let bestLength = 0;

  while ((match = arrayRegex.exec(text)) !== null) {
    if (match[0].length > bestLength) {
      bestMatch = match[0];
      bestLength = match[0].length;
    }
  }

  if (bestMatch) {
    try {
      const parsed = JSON.parse(bestMatch);
      return Array.isArray(parsed) ? parsed : null;
    } catch {}

    // Try fixing trailing commas
    try {
      const fixed = bestMatch
        .replace(/,\s*\]/g, ']')
        .replace(/,\s*\}/g, '}');
      const parsed = JSON.parse(fixed);
      return Array.isArray(parsed) ? parsed : null;
    } catch {}
  }

  // 4. Last resort: find individual JSON objects
  const objectRegex = /\{[^{}]*"start_time"\s*:\s*[\d.]+[^{}]*\}/g;
  const objects = [];
  while ((match = objectRegex.exec(text)) !== null) {
    try {
      objects.push(JSON.parse(match[0]));
    } catch {}
  }

  return objects.length > 0 ? objects : null;
}
