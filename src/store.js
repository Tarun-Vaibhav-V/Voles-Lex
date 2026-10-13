// Tiny persisted store (localStorage) — plays the role of the Lex control plane's storage.
import { useSyncExternalStore } from 'react';
import { TEMPLATES } from './engine/templates.js';

const KEY = 'voxlex:v1';

const DEFAULT_SETTINGS = {
  provider: 'ollama',
  ollamaUrl: 'http://localhost:11434',
  model: 'gemma3:4b',
  webllmModel: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
  nluMode: 'llm',
  stt: 'whisper',
  whisperModel: 'onnx-community/whisper-tiny.en',
  voice: '',
  bargeIn: true,
  handsFree: true,
  v2: true,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      // v2: default STT switched to the much smaller whisper-tiny.en (q8, 41 MB)
      if (s.settings && !s.settings.v2) s.settings = { ...s.settings, whisperModel: DEFAULT_SETTINGS.whisperModel, v2: true };
      return { bots: [], logs: {}, usage: { turns: 0, cost: 0, bytes: 0 }, ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings } };
    }
  } catch { /* storage unavailable */ }
  return { bots: [TEMPLATES.PizzaBot()], logs: {}, usage: { turns: 0, cost: 0, bytes: 0 }, settings: DEFAULT_SETTINGS };
}

let state = load();
const subs = new Set();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore quota / private mode */ }
}

export function setState(fn) {
  state = typeof fn === 'function' ? fn(state) : { ...state, ...fn };
  persist();
  subs.forEach((s) => s());
}

export const getState = () => state;

export function useStore(selector = (s) => s) {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => selector(state));
}

// ---- actions -------------------------------------------------------------
export const actions = {
  addBot(bot) { setState((s) => ({ ...s, bots: [...s.bots, bot] })); return bot.id; },
  updateBot(id, fn) {
    setState((s) => ({ ...s, bots: s.bots.map((b) => (b.id === id ? { ...fn(b), updatedAt: new Date().toISOString() } : b)) }));
  },
  deleteBot(id) {
    setState((s) => { const logs = { ...s.logs }; delete logs[id]; return { ...s, bots: s.bots.filter((b) => b.id !== id), logs }; });
  },
  setSettings(patch) { setState((s) => ({ ...s, settings: { ...s.settings, ...patch } })); },
  log(botId, entry) {
    setState((s) => ({
      ...s,
      logs: { ...s.logs, [botId]: [...(s.logs[botId] || []), entry].slice(-500) },
      usage: { turns: s.usage.turns + 1, cost: s.usage.cost + (entry.cost || 0), bytes: s.usage.bytes + (entry.bytes || 0) },
    }));
  },
  clearLogs(botId) { setState((s) => ({ ...s, logs: { ...s.logs, [botId]: [] } })); },
  resetAll() { localStorage.removeItem(KEY); state = load(); subs.forEach((s) => s()); },
};

/** Resolve the bot definition an alias points to (DRAFT or a version snapshot). */
export function resolveAlias(bot, aliasName) {
  const alias = bot.aliases.find((a) => a.name === aliasName) || { version: 'DRAFT' };
  if (alias.version === 'DRAFT') return { def: bot, version: 'DRAFT' };
  const v = bot.versions.find((x) => x.version === alias.version);
  return { def: v ? { ...v.snapshot, id: bot.id } : bot, version: alias.version };
}
