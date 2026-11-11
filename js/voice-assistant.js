// ─── Voice Assistant — voice commands for adding tasks & controlling the timer ──
// Speech-to-text runs entirely in the browser via the free built-in Web Speech API
// (SpeechRecognition) — no audio is uploaded, no separate STT provider or key.
// Only the resulting transcript text is sent to api/voice-command.js, where Claude
// classifies intent and extracts structured parameters. Floating mic button, visible
// on every tab. If the command was ambiguous, the API asks a clarifying question —
// spoken aloud and auto-listened-for, no extra tap needed.
const VoiceAssistant = {
  _recognition: null,
  _listening: false,
  _history: [], // [{role:'user'|'assistant', text}] — cleared once an action resolves

  init() {
    const btn = document.getElementById('voice-assistant-btn');
    if (!btn) return;
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      btn.style.display = 'none'; // Firefox / older Safari — no built-in speech recognition
      return;
    }

    this._recognition = new SpeechRecognitionCtor();
    this._recognition.lang = navigator.language || 'en-US';
    this._recognition.interimResults = false;
    this._recognition.maxAlternatives = 1;
    this._recognition.continuous = false;

    this._recognition.onresult = e => {
      const transcript = e.results?.[0]?.[0]?.transcript || '';
      this._processTranscript(transcript);
    };
    this._recognition.onerror = e => {
      this._setListening(false);
      if (e.error === 'no-speech') return; // nothing spoken — silently drop
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this._toast('⚠️ Microphone access denied', 3000);
        return;
      }
      this._toast(`⚠️ Voice recognition error: ${e.error}`, 3000);
    };
    this._recognition.onend = () => this._setListening(false);

    btn.addEventListener('click', () => this.toggleListening());
  },

  toggleListening() {
    if (this._listening) {
      this._recognition.stop();
      return;
    }
    try {
      this._recognition.start();
      this._setListening(true);
    } catch (_) {
      // start() throws if a recognition session is already active — ignore
    }
  },

  _setListening(on) {
    this._listening = on;
    const btn = document.getElementById('voice-assistant-btn');
    if (!btn) return;
    btn.classList.toggle('recording', on);
    btn.textContent = on ? '⏹' : '🎤';
    btn.title = on ? 'Stop listening' : 'Voice command';
  },

  async _processTranscript(transcript) {
    if (!transcript || !transcript.trim()) return;
    const btn = document.getElementById('voice-assistant-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    try {
      const resp = await fetch('/api/voice-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, history: this._history })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Voice command failed');
      await this._handleResult(transcript, data);
    } catch (e) {
      this._toast(`⚠️ Voice command failed: ${e.message}`, 4000);
      this._history = [];
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🎤'; }
    }
  },

  async _handleResult(transcript, data) {
    this._history.push({ role: 'user', text: transcript });

    if (data.intent === 'clarify') {
      this._history.push({ role: 'assistant', text: data.clarifying_question });
      this._speak(data.clarifying_question);
      this._toast(`🎤 ${data.clarifying_question}`, 6000);
      // Hands-free follow-up — mic permission is already granted this session
      setTimeout(() => this.toggleListening(), 1200);
      return;
    }

    this._history = []; // actionable intent resolved — conversation is done

    if (data.intent === 'add_task') {
      if (typeof switchTimerType === 'function') switchTimerType('tasks');
      let historyId = null;
      if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
        historyId = await Auth.createScanHistory(data.task, 'voice').catch(() => null);
      }
      if (typeof TaskManager !== 'undefined') {
        TaskManager._pendingScan = { historyId, extracted: data.task };
        TaskManager._applyScannedTask(data.task);
      }
    } else if (data.intent === 'start_timer') {
      if (typeof voiceStartTimer === 'function') {
        voiceStartTimer(data.timer.mode || 'work', data.timer.duration_minutes, data.timer.label);
      }
      this._toast(`▶️ Timer started${data.timer.label ? ' — ' + data.timer.label : ''}`, 3000);
    } else if (data.intent === 'stop_timer') {
      if (typeof voiceStopTimer === 'function') voiceStopTimer();
      this._toast('⏸ Timer stopped', 2500);
    }
  },

  _speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    try { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch (_) {}
  },

  _toast(msg, durationMs = 3000) {
    if (typeof TaskManager !== 'undefined' && typeof TaskManager._toast === 'function') {
      TaskManager._toast(msg, durationMs);
      return;
    }
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `
      position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
      background:#1e2d1e; color:#39ff14; border:1px solid rgba(57,255,20,0.3);
      padding:10px 20px; border-radius:12px; font-size:0.82rem; font-weight:600;
      z-index:9999; white-space:nowrap; box-shadow:0 4px 20px rgba(0,0,0,0.5);
    `;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), durationMs);
  }
};

document.addEventListener('DOMContentLoaded', () => VoiceAssistant.init());
