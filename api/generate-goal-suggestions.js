// api/generate-goal-suggestions.js — AI suggestions for the 7-level goal cascade, via Grok
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { levelName, levelNumber, chain } = req.body || {};
  if (!levelName || !levelNumber) return res.status(400).json({ error: 'levelName and levelNumber are required' });

  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROK_API_KEY not configured in Vercel' });

  const systemPrompt = `You are an expert goal-setting coach. This app uses a 7-level goal cascade:
1. Someday, 2. Five-Year, 3. One-Year, 4. Monthly, 5. Weekly, 6. Daily, 7. Right Now.
This is the same logic as OKR cascading (company objective → team objective → individual task) and
Hoshin Kanri, applied to one person's life. Each level must answer "so what do I do about it?" for
the level directly above it — a real cascade means any small task traces up to the Someday goal, and
the Someday goal traces down to something doable right now.
Levels 1-6 (Someday through Daily) are goal/commitment statements, increasingly concrete and time-bound.
Level 7, Right Now, is different in kind: it is not a goal, it is a single literal next action the
person could start within the next minute — e.g. "Open the doc and write the scene where the character
first arrives" rather than "Write more of the book."
Return ONLY valid JSON, no markdown, no explanation, in this exact structure:
{ "suggestions": ["option 1", "option 2", "option 3"] }
Each suggestion should be concise (max ~15 words) and, for levels 1-6, phrased as a concrete goal; for
level 7 (Right Now), phrased as an immediate literal action.`;

  let userPrompt;
  if (Array.isArray(chain) && chain.length > 0) {
    const chainText = chain.map(c => `${c.levelName}: "${c.title}"`).join('\n');
    userPrompt = `Here is the person's goal cascade so far, from the top down:\n${chainText}\n\nSuggest 3 concrete options for their next level: ${levelName} (level ${levelNumber} of 7). Each option should logically answer "so what do I do about it?" for the goal directly above it.`;
  } else {
    userPrompt = `The person is just starting their goal cascade at the top level: ${levelName} (level ${levelNumber} of 7) — their broad "someday" ambition. Suggest 3 example Someday goals covering different common life domains (career, health, relationships, personal growth) as inspiration.`;
  }

  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'grok-3',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt }
        ],
        temperature: 0.8,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: `Grok API error: ${err}` });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(502).json({ error: 'Grok did not return valid JSON', raw: text });

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.suggestions)) return res.status(502).json({ error: 'Malformed suggestions', raw: text });

    return res.status(200).json({ suggestions: parsed.suggestions.slice(0, 3) });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
