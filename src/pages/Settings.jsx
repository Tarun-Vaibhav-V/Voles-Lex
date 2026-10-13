import { useEffect, useState } from 'react';
import { CheckCircle2, Cpu, Globe, Mic, RefreshCw, Volume2, XCircle } from 'lucide-react';
import { actions, useStore } from '../store.js';
import { WEBLLM_MODELS, listOllamaModels, loadWebLLM, warmup } from '../engine/llm.js';
import { localVoices, onWhisperEvent, preloadWhisper } from '../voice/voiceAgent.js';
import { Alert, Badge, Button, Code, Container, Field, Input, Select, Toggle, cx } from '../components/ui.jsx';

const WHISPER_MODELS = [
  { id: 'onnx-community/whisper-tiny.en', label: 'Whisper tiny.en (41 MB, fastest — recommended)' },
  { id: 'onnx-community/whisper-base.en', label: 'Whisper base.en (77 MB, more accurate)' },
  { id: 'onnx-community/whisper-small.en', label: 'Whisper small.en (~250 MB, most accurate)' },
];

export default function Settings() {
  const s = useStore((x) => x.settings);
  const set = actions.setSettings;
  const [models, setModels] = useState(null);
  const [conn, setConn] = useState(null);
  const [voices, setVoices] = useState([]);
  const [whisper, setWhisper] = useState(null);
  const [webllm, setWebllm] = useState(null);

  const refresh = async () => {
    setConn('checking');
    try { setModels(await listOllamaModels(s.ollamaUrl)); setConn('ok'); } catch (e) { setModels(null); setConn(e.message); }
  };
  useEffect(() => { refresh(); }, [s.ollamaUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const load = () => setVoices(localVoices());
    load();
    window.speechSynthesis?.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load);
  }, []);
  useEffect(() => onWhisperEvent((m) => setWhisper(m.type === 'ready' ? `Ready ✓ (loaded in ${(m.ms / 1000).toFixed(1)} s)` : m.type === 'load-error' ? `Error: ${m.error}` : `Downloading ${Math.round(m.progress)}% (${(m.loaded / 1e6).toFixed(0)}/${(m.total / 1e6).toFixed(0)} MB)`)), []);

  const origin = window.location.origin;
  const isLocalhost = /localhost|127\.0\.0\.1/.test(origin);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Local AI runtime</h1>
        <p className="text-muted">Where VoxLex runs its language model, speech recognition and speech synthesis. Everything here stays on this device.</p>
      </div>

      <Container title="Language model (NLU, bot generator, coach)">
        <div className="grid md:grid-cols-2 gap-3 mb-5">
          {[
            { key: 'ollama', icon: Cpu, title: 'Ollama (recommended)', text: 'Runs Gemma 3 / Qwen natively on your Mac/PC GPU. Fastest and most accurate.' },
            { key: 'webllm', icon: Globe, title: 'WebLLM (in-browser)', text: 'Runs a small model inside this tab via WebGPU. Zero install — works on the deployed site.' },
          ].map((o) => (
            <button key={o.key} onClick={() => set({ provider: o.key })} className={cx('rounded-lg border p-4 text-left', s.provider === o.key ? 'border-link ring-1 ring-link bg-blue-50/40' : 'border-line')}>
              <div className="flex items-center gap-2 font-semibold"><o.icon size={16} className="text-action" />{o.title}</div>
              <p className="text-xs text-muted mt-1">{o.text}</p>
            </button>
          ))}
        </div>

        {s.provider === 'ollama' ? (
          <div className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Ollama URL"><Input value={s.ollamaUrl} onChange={(e) => set({ ollamaUrl: e.target.value })} /></Field>
              <Field label="Model">
                <div className="flex gap-2">
                  <Select value={s.model} onChange={(e) => set({ model: e.target.value })}>
                    {!models?.some((m) => m.name === s.model) && <option value={s.model}>{s.model} (not installed)</option>}
                    {models?.map((m) => <option key={m.name} value={m.name}>{m.name} · {(m.size / 1e9).toFixed(1)} GB</option>)}
                  </Select>
                  <Button icon={RefreshCw} onClick={refresh} />
                </div>
              </Field>
            </div>
            {conn === 'ok' && <Alert tone="ok"><span className="flex items-center gap-2"><CheckCircle2 size={15} className="text-ok" /> Connected to Ollama · {models.length} model(s) installed. <Button size="sm" variant="link" onClick={() => warmup(s)}>Warm up model</Button></span></Alert>}
            {conn && conn !== 'ok' && conn !== 'checking' && (
              <Alert tone="error">
                <div className="flex items-center gap-2 font-semibold"><XCircle size={15} className="text-bad" /> Can't reach Ollama at {s.ollamaUrl}</div>
                <p className="mt-1">Install from ollama.com, then run:</p>
                <Code className="mt-2">{`ollama pull gemma3:4b\n${isLocalhost ? 'ollama serve' : `OLLAMA_ORIGINS="${origin}" ollama serve`}`}</Code>
                {!isLocalhost && <p className="mt-2 text-xs">Because this page is served from <b>{origin}</b>, Ollama must allow that origin (OLLAMA_ORIGINS). On macOS app: <code>launchctl setenv OLLAMA_ORIGINS "{origin}"</code> then restart Ollama.</p>}
              </Alert>
            )}
            <p className="text-xs text-muted">Recommended: <b>gemma3:4b</b> (best accuracy/speed), <b>gemma3:1b</b> or <b>qwen2.5:1.5b</b> on low-RAM machines.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="In-browser model" className="max-w-md">
              <Select value={s.webllmModel} onChange={(e) => set({ webllmModel: e.target.value })}>{WEBLLM_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select>
            </Field>
            <Button onClick={async () => { setWebllm('Starting…'); try { await loadWebLLM(s.webllmModel, (t) => setWebllm(t)); setWebllm('Loaded ✓'); } catch (e) { setWebllm(`Error: ${e.message}`); } }}>Download & load model</Button>
            {webllm && <p className="text-xs text-muted font-mono">{webllm}</p>}
            {!('gpu' in navigator) && <Alert tone="warn">WebGPU isn't available in this browser. Use Chrome or Edge, or switch to Ollama.</Alert>}
          </div>
        )}
      </Container>

      <Container title="Speech recognition (Transcribe)">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Engine">
            <Select value={s.stt} onChange={(e) => set({ stt: e.target.value })}>
              <option value="whisper">Whisper — on-device (private)</option>
              <option value="browser">Browser Web Speech API (may use cloud)</option>
            </Select>
          </Field>
          {s.stt === 'whisper' && (
            <Field label="Whisper model">
              <div className="flex gap-2">
                <Select value={s.whisperModel} onChange={(e) => set({ whisperModel: e.target.value })}>{WHISPER_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select>
                <Button onClick={() => { setWhisper('Loading…'); preloadWhisper(s.whisperModel); }}>Preload</Button>
              </div>
            </Field>
          )}
        </div>
        {whisper && <p className="text-xs text-muted mt-2 font-mono flex items-center gap-1.5"><Mic size={12} />{whisper}</p>}
        {s.stt === 'browser' && <Alert tone="warn" className="mt-3">In Chrome the Web Speech API streams audio to Google's servers — VoxLex will count those bytes as leaving the device.</Alert>}
      </Container>

      <Container title="Speech synthesis (Polly) & conversation">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Voice" hint="Voices marked on-device are synthesised locally by your OS.">
            <div className="flex gap-2">
              <Select value={s.voice} onChange={(e) => set({ voice: e.target.value })}>
                <option value="">System default</option>
                {voices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang}){v.local ? ' · on-device' : ' · cloud'}</option>)}
              </Select>
              <Button icon={Volume2} onClick={() => { const u = new SpeechSynthesisUtterance('Hi, I am your VoxLex voice agent, running entirely on this device.'); const v = speechSynthesis.getVoices().find((x) => x.name === s.voice); if (v) u.voice = v; speechSynthesis.cancel(); speechSynthesis.speak(u); }} />
            </div>
          </Field>
          <div className="space-y-3 pt-1">
            <Toggle checked={s.bargeIn} onChange={(v) => set({ bargeIn: v })} label={<span><b>Barge-in</b> — interrupt the bot by speaking <Badge tone="purple">Enhancement</Badge></span>} />
            <Toggle checked={s.handsFree} onChange={(v) => set({ handsFree: v })} label={<span><b>Hands-free</b> — keep listening after each reply</span>} />
            <p className="text-xs text-muted">Tip: use headphones for the most reliable barge-in.</p>
          </div>
        </div>
      </Container>

      <div className="flex justify-end">
        <Button variant="danger" onClick={() => { if (confirm('Reset VoxLex? All bots, logs and settings in this browser will be erased.')) actions.resetAll(); }}>Reset all local data</Button>
      </div>
    </div>
  );
}
