// api/extract-task-from-photo.js — AI assistant: extract a task from a submitted photo via Claude vision
import Anthropic from '@anthropic-ai/sdk';

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image, mediaType, corrections } = req.body || {};
  if (!image) return res.status(400).json({ error: 'image (base64) is required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured in Vercel' });

  const finalMediaType = ALLOWED_MEDIA_TYPES.includes(mediaType) ? mediaType : 'image/jpeg';
  const today = new Date().toISOString().slice(0, 10);
  const client = new Anthropic({ apiKey });

  let correctionsNote = '';
  if (Array.isArray(corrections) && corrections.length > 0) {
    const lines = corrections.slice(0, 12)
      .filter(c => c && c.field)
      .map(c => `- ${c.field}: guessed "${c.from}", user changed it to "${c.to}"`)
      .join('\n');
    if (lines) {
      correctionsNote = `\n\nThis user has corrected these fields on past photo scans — treat them as a soft signal for their personal preferences (category naming, typical priority/time-estimate habits), but still base your answer primarily on what is actually visible in THIS photo:\n${lines}`;
    }
  }

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system: `You extract a single actionable task from a photo — a handwritten sticky note, a whiteboard, a printed schedule, a screenshot, a to-do list, etc. Today's date is ${today} (YYYY-MM-DD). Read any visible text and infer one clear, concise task. If a relative date is mentioned ("tomorrow", "Friday", "next week"), resolve it to an absolute YYYY-MM-DD date relative to today. If a time is mentioned, resolve it to 24-hour HH:MM. If the photo shows multiple items, pick the single most prominent or urgent one. If nothing looks like a task, still summarize the most actionable thing visible.${correctionsNote}`,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: finalMediaType, data: image } },
          { type: 'text', text: 'Extract one task from this photo.' }
        ]
      }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              title:              { type: 'string',  description: 'Short, clear task title, max ~80 chars' },
              category:           { type: 'string',  description: 'Best-guess category label, e.g. Work, Personal, Health, Errand' },
              priority:           { type: 'integer', enum: [1, 2, 3, 4, 5], description: '1 = lowest, 5 = highest, best guess' },
              estimated_minutes:  { type: 'integer', description: 'Best-guess time estimate in minutes; 25 if unknown' },
              scheduled_date:     { type: 'string',  description: 'YYYY-MM-DD deadline or planned date if one was found in the photo (e.g. "submit by Friday"), else empty string' },
              scheduled_time:     { type: 'string',  description: 'HH:MM 24-hour if a time was found in the photo, else empty string' },
              details:            { type: 'string',  description: 'Any extra context/notes visible in the photo, else empty string' }
            },
            required: ['title', 'category', 'priority', 'estimated_minutes', 'scheduled_date', 'scheduled_time', 'details'],
            additionalProperties: false
          }
        }
      }
    });

    if (response.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'Claude declined to process this image' });
    }

    const block = response.content.find(b => b.type === 'text');
    if (!block) return res.status(502).json({ error: 'No text content in Claude response' });

    let task;
    try {
      task = JSON.parse(block.text);
    } catch {
      return res.status(502).json({ error: 'Claude did not return valid JSON', raw: block.text });
    }

    return res.status(200).json({ task });

  } catch (e) {
    const status = e?.status && Number.isInteger(e.status) ? e.status : 500;
    return res.status(status).json({ error: e.message || 'Claude API request failed' });
  }
}
