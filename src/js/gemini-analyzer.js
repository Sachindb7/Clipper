/**
 * gemini-analyzer.js — Gemini 2.5 Flash viral moment detection
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

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

═══════════════════════════════════════════
HOOK TEXT — THIS IS THE MOST IMPORTANT PART
═══════════════════════════════════════════

The hook text appears at the TOP of the reel. It's the FIRST thing people see. If the hook is boring, nobody watches. Your hooks must create an IRRESISTIBLE urge to keep watching.

HOOK PSYCHOLOGY — use these techniques:
1. CURIOSITY GAP — hint at something without revealing it: "What he said next... 😳🔥"
2. SUSPENSE / CLIFFHANGER — make them wait: "Watch till the end 👀💀"  
3. SHOCK VALUE — imply something wild happened: "This shouldn't exist 🤯"
4. INCOMPLETE THOUGHT — cut off mid-idea: "When he realized... 😱"
5. BOLD CLAIM — challenge a belief: "Nobody's ready for this 🤫🔥"
6. RELATABLE PAIN — tap into shared feelings: "Why does this hit so hard 😭💯"
7. CONTROVERSY — stir debate: "He really said that?! 🫢🔥"
8. FOMO — make them feel they're missing out: "You NEED to hear this 👂🔥"

HOOK FORMAT RULES:
- 3-7 words MAX (shorter = more powerful)
- MUST include 2-3 relevant emojis
- The hook should NOT describe what happens — it should TEASE it
- Think: "If I read this hook while scrolling, would I STOP to watch?"
- Hook must feel native to Instagram/TikTok culture

EXCELLENT HOOK EXAMPLES (study these patterns):
✅ "Wait for it... 👀🔥"
✅ "What he said next 😳💀"
✅ "Nobody was ready 🤯🔥"  
✅ "This changes everything 😱💯"
✅ "He wasn't supposed to say this 🤫😱"
✅ "I can't believe this 💀😭"
✅ "The ending tho... 👀🤯"
✅ "You're not gonna believe this 😳🔥"
✅ "This is why we can't have nice things 💀😂"
✅ "bro really went there 🫢💀"
✅ "Plot twist incoming 🔄😱"
✅ "The truth nobody tells you 🤫💯"
✅ "This hit different at 3am 😭🔥"
✅ "POV: when reality hits 💀😂"

FORBIDDEN HOOKS (never use these boring patterns):
❌ "[Person name] talks about [topic]"
❌ "Discussion about [topic]"  
❌ "[Person] explains [thing]"
❌ Any hook that simply describes the clip content
❌ Any hook longer than 7 words (excluding emojis)

REMEMBER: MINIMUM 3 CLIPS. SHORT clips (7-9 seconds) are ALWAYS better. Your hooks should make someone physically unable to scroll past.

Respond with ONLY a raw JSON array, NO markdown, NO code blocks, NO backticks:
[{"start_time": 5.2, "end_time": 13.1, "hook_text": "What he said next 😳🔥", "reason": "Strong emotional reaction"}]`;


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
