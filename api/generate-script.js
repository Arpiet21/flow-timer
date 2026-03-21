// api/generate-script.js — Generate video script using Grok API
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { projectName, description, style, duration, shots, model } = req.body || {};
  if (!description) return res.status(400).json({ error: 'description is required' });

  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROK_API_KEY not configured in Vercel' });

  const systemPrompt = `You are an expert video director and cinematographer.
Generate a structured JSON video script based on the user's brief.
Return ONLY valid JSON — no markdown, no explanation, just the JSON object.
Use this exact structure:
{
  "project": "Project Name",
  "total_duration": "40s",
  "global_style": {
    "cinematic_style": "...",
    "camera": "...",
    "lighting": "...",
    "color_grade": "...",
    "resolution": "4K ultra realistic",
    "texture": "...",
    "music_theme": "...",
    "character_consistency": {
      "main": "..."
    }
  },
  "shots": [
    {
      "id": "S01_A",
      "duration": 2,
      "prompt": "Detailed cinematic prompt for this shot...",
      "motion": "camera movement description",
      "mood": "emotional tone"
    }
  ]
}`;

  const userPrompt = `Project: ${projectName || 'Brand Film'}
Description: ${description}
Style: ${style || 'cinematic, warm, emotional'}
Total Duration: ${duration || '40 seconds'}
Number of shots: ${shots || 12}
Video Model target: ${model || 'Sora / Runway / Kling'}

Generate a complete shot-by-shot video script JSON. Make prompts highly detailed and cinematic for AI video generation.`;

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
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: `Grok API error: ${err}` });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(502).json({ error: 'Grok did not return valid JSON', raw: text });

    const script = JSON.parse(jsonMatch[0]);
    return res.status(200).json({ script });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
