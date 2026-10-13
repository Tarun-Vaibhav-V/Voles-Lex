// Local voice loop: microphone → VAD → Whisper (on-device STT) → bot → speechSynthesis (on-device TTS)
// with barge-in: if the user starts talking while the bot speaks, the bot stops and listens.

let worker = null;
let reqId = 0;
const pending = new Map();
const listeners = new Set();
// Per-model load status: { state: 'loading'|'ready'|'error', progress, error }
const status = {};

export const whisperStatus = (model) => status[model] || { state: 'idle', progress: 0 };

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') status[m.model] = { state: 'loading', progress: m.progress, loaded: m.loaded, total: m.total };
    if (m.type === 'ready') status[m.model] = { state: 'ready', progress: 100 };
    if (m.type === 'load-error') status[m.model] = { state: 'error', error: m.error };
    if (m.type === 'result' || m.type === 'error') {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (!p) return;
      if (m.type === 'result') p.resolve(m);
      else p.reject(new Error(m.error));
    } else {
      listeners.forEach((fn) => fn(m));
    }
  };
  return worker;
}

export const onWhisperEvent = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const preloadWhisper = (model) => {
  const s = whisperStatus(model).state;
  if (s === 'loading' || s === 'ready') return;
  status[model] = { state: 'loading', progress: 0 };
  getWorker().postMessage({ type: 'load', model });
};

export function transcribeWhisper(audio, model) {
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ type: 'transcribe', audio, model, id }, [audio.buffer]);
  });
}

function resample(chunks, fromRate, toRate = 16000) {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const input = new Float32Array(len);
  let o = 0;
  for (const c of chunks) { input.set(c, o); o += c.length; }
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(len / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, len - 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (x - i0);
  }
  return out;
}

export function cleanForSpeech(text) {
  return text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/[*_`#]/g, '').replace(/₹\s?(\d+)/g, '$1 rupees');
}

export function localVoices() {
  const all = window.speechSynthesis?.getVoices() || [];
  const en = all.filter((v) => v.lang.startsWith('en'));
  return (en.length ? en : all).map((v) => ({ name: v.name, lang: v.lang, local: v.localService }));
}

export class VoiceAgent {
  constructor({ onLevel, onState } = {}) {
    this.onLevel = onLevel;
    this.onState = onState;
    this.state = 'off';
    this.noiseFloor = 0.008;
  }

  setState(s) { this.state = s; this.onState?.(s); }

  async start() {
    if (this.ctx) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(2048, 1, 1);
    this.preroll = [];
    this.capture = null;
    this.proc.onaudioprocess = (e) => {
      const d = new Float32Array(e.inputBuffer.getChannelData(0));
      let sum = 0;
      for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      const rms = Math.sqrt(sum / d.length);
      this.onLevel?.(rms);
      this.preroll.push(d);
      if (this.preroll.length > 12) this.preroll.shift(); // ≈0.5 s of pre-roll
      if (this.capture) this.capture(d, rms);
      if (this.monitor) this.monitor(rms);
      if (!this.capture && this.state !== 'speaking') this.noiseFloor = this.noiseFloor * 0.98 + Math.min(rms, 0.05) * 0.02;
    };
    src.connect(this.proc);
    this.proc.connect(this.ctx.destination);
    this.setState('idle');
  }

  stop() {
    this.capture = null;
    this.monitor = null;
    window.speechSynthesis?.cancel();
    this.proc?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.ctx = null;
    this.setState('off');
  }

  /** Record one utterance using energy-based VAD. Resolves { audio: Float32Array@16k, seconds } or null. */
  listen({ silenceMs = 800, maxMs = 15000, noSpeechMs = 8000 } = {}) {
    this.setState('listening');
    return new Promise((resolve) => {
      const rate = this.ctx.sampleRate;
      const frameMs = (2048 / rate) * 1000;
      const chunks = [...this.preroll];
      let speaking = false;
      let voiced = 0;
      let silence = 0;
      let elapsed = 0;
      const done = (ok) => {
        this.capture = null;
        this._cancelListen = null;
        this.setState('idle');
        if (!ok) return resolve(null);
        const audio = resample(chunks, rate);
        resolve({ audio, seconds: audio.length / 16000 });
      };
      this._cancelListen = () => done(false);
      this.capture = (d, rms) => {
        chunks.push(d);
        elapsed += frameMs;
        const thr = Math.max(0.015, this.noiseFloor * 3);
        if (rms > thr) { voiced += frameMs; silence = 0; if (voiced > 120) speaking = true; } else { silence += frameMs; }
        if (!speaking && chunks.length > 24) chunks.splice(0, chunks.length - 24); // keep a rolling window before speech
        if (speaking && silence > silenceMs) done(true);
        else if (elapsed > maxMs) done(speaking);
        else if (!speaking && elapsed > noSpeechMs) done(false);
      };
    });
  }

  /** Force-finish the current recording (push-to-talk release). */
  cancelListen() { this._cancelListen?.(); }

  /** Speak text; resolves { interrupted } — interrupted=true when the user barged in. */
  speak(text, { voiceName, rate = 1.05, bargeIn = true } = {}) {
    const synth = window.speechSynthesis;
    if (!synth) return Promise.resolve({ interrupted: false });
    synth.cancel();
    this.setState('speaking');
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(cleanForSpeech(text));
      const v = synth.getVoices().find((x) => x.name === voiceName);
      if (v) u.voice = v;
      u.rate = rate;
      let loud = 0;
      let finished = false;
      const end = (interrupted) => {
        if (finished) return;
        finished = true;
        this.monitor = null;
        if (this.state === 'speaking') this.setState('idle');
        resolve({ interrupted });
      };
      if (bargeIn && this.ctx) {
        const frameMs = (2048 / this.ctx.sampleRate) * 1000;
        const start = performance.now();
        this.monitor = (rms) => {
          if (performance.now() - start < 350) return; // ignore TTS onset
          const thr = Math.max(0.045, this.noiseFloor * 6);
          loud = rms > thr ? loud + frameMs : Math.max(0, loud - frameMs / 2);
          if (loud > 220) { synth.cancel(); end(true); }
        };
      }
      u.onend = () => end(false);
      u.onerror = () => end(false);
      synth.speak(u);
    });
  }
}

/** Fallback STT using the browser's Web Speech API (note: Chrome sends audio to Google). */
export function browserRecognize() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return Promise.reject(new Error('Web Speech API not supported in this browser'));
  return new Promise((resolve, reject) => {
    const r = new SR();
    r.lang = 'en-US';
    r.interimResults = false;
    r.maxAlternatives = 1;
    const t0 = performance.now();
    r.onresult = (e) => resolve({ text: e.results[0][0].transcript, ms: Math.round(performance.now() - t0) });
    // Silence / aborts are normal in a hands-free loop — treat them as "nothing heard".
    r.onerror = (e) => (['no-speech', 'aborted'].includes(e.error) ? resolve({ text: '', ms: 0 }) : reject(new Error(e.error)));
    r.onend = () => resolve({ text: '', ms: 0 });
    r.start();
  });
}
