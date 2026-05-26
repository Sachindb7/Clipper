/**
 * gemini-analyzer.js — Gemini 2.5 Flash viral moment detection
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SYSTEM_PROMPT = `You are a VIRAL CONTENT GENIUS and top-tier social media strategist. Your job: extract MULTIPLE short clips from a video transcript for Instagram Reels / TikToks / YouTube Shorts.

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

HOOK TEXT RULES (CRITICAL):
- Hook text appears at TOP of the reel — it MUST stop the scroll
- Use 3-7 words MAX
- MUST include relevant emojis (2-3 emojis per hook)
- Create curiosity gap — make viewer NEED to watch
- Examples: "He said WHAT?! 😱🔥", "This hit different 💀😭", "No way this is real 🤯", "POV: when it goes wrong 😂💀", "Wait for it... 👀🔥", "Nobody talks about this 🤫💯"
- Hook should feel native to Instagram/TikTok culture

REMEMBER: MINIMUM 3 CLIPS. If the transcript is long enough for 5, return 5. SHORT clips (7-9 seconds) are ALWAYS better than long ones.

Respond with ONLY a raw JSON array, NO markdown, NO code blocks, NO backticks:
[{"start_time": 5.2, "end_time": 13.1, "hook_text": "He said WHAT?! 😱🔥", "reason": "Strong emotional reaction"}]`;

/**
 * Analyze transcript with Gemini 2.5 Flash to find viral moments
 * @param {{ text: string, chunks: Array<{ text: string, timestamp: [number, number] }> }} transcript
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<Array<{ start_time: number, end_time: number, hook_text: string, reason: string }> | null>}
 */
export async function analyzeTranscript(transcript, apiKey) {
  if (!apiKey || !apiKey.trim()) {
    console.warn('No Gemini API key provided');
    return null;
  }

  try {
    // Format transcript with timestamps for Gemini
    const formattedTranscript = formatTranscriptForGemini(transcript);

    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${SYSTEM_PROMPT}\n\n--- TRANSCRIPT WITH TIMESTAMPS ---\n${formattedTranscript}\n--- END TRANSCRIPT ---`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.8,
          topP: 0.95,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('Gemini API error:', response.status, errData);
      throw new Error(`Gemini API returned ${response.status}: ${errData?.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      console.error('No text in Gemini response');
      return null;
    }

    console.log('Gemini raw response:', rawText);

    // Parse JSON from response (handle all possible formats)
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
    return null;
  }
}

function formatTranscriptForGemini(transcript) {
  if (!transcript.chunks || transcript.chunks.length === 0) {
    return transcript.text || '';
  }

  return transcript.chunks
    .map((chunk) => {
      const start = chunk.timestamp?.[0] ?? 0;
      const end = chunk.timestamp?.[1] ?? start;
      return `[${start.toFixed(2)}s - ${end.toFixed(2)}s] ${chunk.text}`;
    })
    .join('\n');
}

function parseJsonFromResponse(text) {
  // Clean the text
  let cleaned = text.trim();

  // 1. Try parsing as-is
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : null;
  } catch {}

  // 2. Remove markdown code fences (```json ... ``` or ``` ... ```)
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

    // Try fixing common JSON issues (trailing commas, etc.)
    try {
      const fixed = bestMatch
        .replace(/,\s*\]/g, ']')  // trailing comma before ]
        .replace(/,\s*\}/g, '}'); // trailing comma before }
      const parsed = JSON.parse(fixed);
      return Array.isArray(parsed) ? parsed : null;
    } catch {}
  }

  // 4. Last resort: try to find individual JSON objects
  const objectRegex = /\{[^{}]*"start_time"\s*:\s*[\d.]+[^{}]*\}/g;
  const objects = [];
  while ((match = objectRegex.exec(text)) !== null) {
    try {
      objects.push(JSON.parse(match[0]));
    } catch {}
  }

  return objects.length > 0 ? objects : null;
}
