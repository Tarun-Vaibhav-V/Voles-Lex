import { useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Key, Lock, Mic, RefreshCw, Sparkles, Volume2, XCircle } from 'lucide-react';
import { actions, useStore } from '../store.js';
import { GROQ_MODELS, validateGroqKey } from '../engine/llm.js';
import { localVoices, onWhisperEvent, preloadWhisper } from '../voice/voiceAgent.js';
import { Alert, Badge, Button, Container, Field, Input, Select, Toggle } from '../components/ui.jsx';

const WHISPER_MODELS = [
  { id: 'onnx-community/whisper-tiny.en', label: 'Whisper tiny.en (41 MB, fastest — recommended)' },
  { id: 'onnx-community/whisper-base.en', label: 'Whisper base.en (77 MB, more accurate)' },
  { id: 'onnx-community/whisper-small.en', label: 'Whisper small.en (~250 MB, most accurate)' },
];

export default function Settings() {
  const s = useStore((x) => x.settings);
  const set = actions.setSettings;
  const [showKey, setShowKey] = useState(false);
  const [valStatus, setValStatus] = useState(null); // 'validating' | 'ok' | 'error' | null
  const [valMsg, setValMsg] = useState('');
  const [voices, setVoices] = useState([]);
  const [whisper, setWhisper] = useState(null);

  useEffect(() => {
    const load = () => setVoices(localVoices());
    load();
    window.speechSynthesis?.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load);
  }, []);

  useEffect(() => onWhisperEvent((m) => setWhisper(m.type === 'ready' ? `Ready ✓ (loaded in ${(m.ms / 1000).toFixed(1)} s)` : m.type === 'load-error' ? `Error: ${m.error}` : `Downloading ${Math.round(m.progress)}% (${(m.loaded / 1e6).toFixed(0)}/${(m.total / 1e6).toFixed(0)} MB)`)), []);

  const handleTestKey = async () => {
    if (!s.groqApiKey?.trim()) {
      setValStatus('error');
      setValMsg('Please enter an API key first.');
      return;
    }
    setValStatus('validating');
    setValMsg('Testing connection to Groq API…');
    try {
      await validateGroqKey(s.groqApiKey, s.groqBaseUrl);
      setValStatus('ok');
      setValMsg('API key verified! Connected to Groq successfully.');
    } catch (err) {
      setValStatus('error');
      setValMsg(err.message || 'Verification failed');
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">AI & Runtime Settings</h1>
        <p className="text-muted">Configure Groq Cloud AI inference, speech recognition, and synthesis.</p>
      </div>

      <Container title="Language Model (Groq LPU Inference)">
        <div className="space-y-4">
          <Alert tone="ok">
            <div className="flex items-start gap-2">
              <Lock size={16} className="text-ok shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed">
                <span className="font-semibold text-ink">Zero API Key Exposure:</span> Your Groq API key is stored <b>only inside your browser's localStorage</b>. It is never embedded in the repository, never bundled in the frontend code, and never sent to any third party other than Groq.
              </div>
            </div>
          </Alert>

          <div className="grid md:grid-cols-2 gap-4">
            <Field
              label="Groq API Key"
              hint={
                <span>
                  Don't have a key?{' '}
                  <a
                    href="https://console.groq.com/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="text-link hover:underline font-medium"
                  >
                    Get a free key at console.groq.com →
                  </a>
                </span>
              }
            >
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder="gsk_..."
                    value={s.groqApiKey || ''}
                    onChange={(e) => {
                      set({ groqApiKey: e.target.value.trim() });
                      setValStatus(null);
                    }}
                    className="pr-10 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                    title={showKey ? 'Hide key' : 'Show key'}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <Button
                  onClick={handleTestKey}
                  disabled={valStatus === 'validating'}
                  icon={valStatus === 'validating' ? RefreshCw : Sparkles}
                >
                  {valStatus === 'validating' ? 'Testing…' : 'Test Key'}
                </Button>
              </div>
            </Field>

            <Field label="Groq Model" hint="Llama 3.3 70B delivers the highest accuracy for zero-shot slot extraction.">
              <Select
                value={s.groqModel || 'llama-3.3-70b-versatile'}
                onChange={(e) => set({ groqModel: e.target.value })}
              >
                {GROQ_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {valStatus === 'ok' && (
            <Alert tone="ok">
              <span className="flex items-center gap-2">
                <CheckCircle2 size={15} className="text-ok" />
                {valMsg}
              </span>
            </Alert>
          )}

          {valStatus === 'error' && (
            <Alert tone="error">
              <span className="flex items-center gap-2">
                <XCircle size={15} className="text-bad" />
                {valMsg}
              </span>
            </Alert>
          )}

          {!s.groqApiKey && (
            <div className="text-xs text-muted flex items-center gap-1.5 pt-1">
              <Key size={13} className="text-amber-500" />
              <span>Without an API key, Lex Classic utterance matching still works in the test console. Enter your key to enable the LLM zero-shot NLU, bot generator, and utterance coach.</span>
            </div>
          )}
        </div>
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
                <Select value={s.whisperModel} onChange={(e) => set({ whisperModel: e.target.value })}>
                  {WHISPER_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </Select>
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
              <Button icon={Volume2} onClick={() => { const u = new SpeechSynthesisUtterance('Hi, I am your VoxLex voice agent, powered by Groq and Amazon Lex.'); const v = speechSynthesis.getVoices().find((x) => x.name === s.voice); if (v) u.voice = v; speechSynthesis.cancel(); speechSynthesis.speak(u); }} />
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
