// api/voice-command.js — AI assistant: voice commands for adding tasks & controlling the timer
// Speech-to-text happens client-side via the browser's free built-in Web Speech API
// (js/voice-assistant.js) — no audio reaches this route. It only classifies intent
// and extracts structured parameters from the transcript, via Claude.
import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { transcript, history } = req.body || {};
  if (!transcript || !String(transcript).trim()) return res.status(400).json({ error: 'transcript is required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured in Vercel' });

  const today = new Date().toISOString().slice(0, 10);
  const client = new Anthropic({ apiKey });

  // Prior turns (if this is a follow-up answering a clarifying question)
  const priorTurns = Array.isArray(history) ? history.slice(-10) : [];
  const messages = priorTurns
    .filter(t => t && t.text && (t.role === 'user' || t.role === 'assistant'))
    .map(t => ({ role: t.role, content: t.text }));
  messages.push({ role: 'user', content: String(transcript).trim() });

  const systemPrompt = `You are a voice command interpreter for a focus-timer + task app. Today's date is ${today} (YYYY-MM-DD). Classify the user's spoken command into exactly one intent:
- "add_task": they want to create a task. Fill "task". Use reasonable defaults for anything minor and unspecified (estimated_minutes: 25, priority: 3, category: "General", scheduled_date/scheduled_time: "" if no date/time was mentioned) — never ask for clarification just because an optional field is missing.
- "start_timer": they want to start a focus/work session or a workout. Fill "timer". mode is "work" for a focus/study/work session (the default whenever unclear) or "workout" only if they explicitly say workout/exercise/HIIT/gym. duration_minutes defaults to 25 if unspecified (ignored for workout, which runs its own preset). label is the task/activity name they mention, else empty string.
- "stop_timer": they want to stop, pause, or end whichever timer is currently running.
- "clarify": ONLY when the command is genuinely ambiguous or missing information that cannot be reasonably defaulted — e.g. you cannot tell if they want to add a task or start a timer, or the transcript is unintelligible/off-topic/empty of any actionable request. Set "clarifying_question" to a short, natural, spoken-style question. Ask only what's essential — never about optional details like category, priority, or duration.
Return ONLY the structured JSON — no prose.`;

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              intent: { type: 'string', enum: ['add_task', 'start_timer', 'stop_timer', 'clarify'] },
              clarifying_question: { type: 'string', description: 'Spoken-style question if intent is "clarify", else empty string' },
              task: {
                type: 'object',
                properties: {
                  title:             { type: 'string' },
                  category:          { type: 'string' },
                  priority:          { type: 'integer', enum: [1, 2, 3, 4, 5] },
                  estimated_minutes: { type: 'integer' },
                  scheduled_date:    { type: 'string' },
                  scheduled_time:    { type: 'string' },
                  details:           { type: 'string' }
                },
                required: ['title', 'category', 'priority', 'estimated_minutes', 'scheduled_date', 'scheduled_time', 'details'],
                additionalProperties: false
              },
              timer: {
                type: 'object',
                properties: {
                  mode:             { type: 'string', enum: ['work', 'workout', ''] },
                  duration_minutes: { type: 'integer' },
                  label:            { type: 'string' }
                },
                required: ['mode', 'duration_minutes', 'label'],
                additionalProperties: false
              }
            },
            required: ['intent', 'clarifying_question', 'task', 'timer'],
            additionalProperties: false
          }
        }
      }
    });

    if (response.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'Claude declined to process this request' });
    }

    const block = response.content.find(b => b.type === 'text');
    if (!block) return res.status(502).json({ error: 'No text content in Claude response' });

    let parsed;
    try {
      parsed = JSON.parse(block.text);
    } catch {
      return res.status(502).json({ error: 'Claude did not return valid JSON', raw: block.text });
    }

    return res.status(200).json({ transcript, ...parsed });

  } catch (e) {
    const status = e?.status && Number.isInteger(e.status) ? e.status : 500;
    return res.status(status).json({ error: e.message || 'Claude API request failed' });
  }
}
