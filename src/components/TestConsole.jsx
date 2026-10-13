import { useEffect, useRef, useState } from 'react';
import { Braces, CircleStop, Mic, RotateCcw, Send, ShieldCheck, Sparkles, Type, X, Zap } from 'lucide-react';
import { actions, resolveAlias, useStore } from '../store.js';
import { newSession, recognizeText } from '../engine/dialog.js';
import { classicInterpret } from '../engine/classicNlu.js';
import { runCodeHook } from '../engine/lambda.js';
import { turnBytes, turnCost, usd } from '../engine/cost.js';
import { VoiceAgent, browserRecognize, onWhisperEvent, preloadWhisper, transcribeWhisper, whisperStatus } from '../voice/voiceAgent.js';
import { Badge, Code, cx } from './ui.jsx';

let runtimeServerDown = false; // stop probing the optional `npm run server` after the first failure

const NLU_MODES = [
  { key: 'classic', label: 'Classic', icon: Type, hint: 'Utterance matching, like stock Lex' },
  { key: 'llm', label: 'LLM', icon: Sparkles, hint: 'Groq LLM zero-shot understands free-form speech' },
  { key: 'compare', label: 'Compare', icon: Zap, hint: 'Groq drives dialog; shows what Classic Lex would have done' },
];

const VSTATE = {
  listening: { label: 'Listening…', tone: 'text-action' },
  transcribing: { label: 'Transcribing on-device…', tone: 'text-link' },
  thinking: { label: 'Thinking…', tone: 'text-violet-700' },
  speaking: { label: 'Speaking — talk to interrupt', tone: 'text-ok' },
  idle: { label: 'Ready', tone: 'text-muted' },
  off: { label: '', tone: '' },
};

export default function TestConsole({ bot, onClose }) {
  const settings = useStore((s) => s.settings);
  const [mode, setMode] = useState(settings.nluMode === 'classic' ? 'classic' : 'llm');
  const [alias, setAlias] = useState('TestBotAlias');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [inspect, setInspect] = useState(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [vstate, setVstate] = useState('off');
  const [whisperMsg, setWhisperMsg] = useState('');
  const [error, setError] = useState('');

  const session = useRef(newSession());
  const lastTurn = useRef(Date.now());
  const agent = useRef(null);
  const voiceRef = useRef(false);
  const level = useRef(0);
  const latest = useRef({});
  latest.current = { settings, mode, alias, bot };
  const listRef = useRef();

  useEffect(() => { listRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }); }, [messages, busy]);
  useEffect(() => onWhisperEvent((m) => {
    if (m.type === 'progress') setWhisperMsg(`Whisper downloading ${Math.round(m.progress)}% (${(m.loaded / 1e6).toFixed(0)}/${(m.total / 1e6).toFixed(0)} MB) — using browser speech meanwhile`);
    else if (m.type === 'ready') setWhisperMsg('');
    else if (m.type === 'load-error') { setWhisperMsg(''); setError(`Whisper failed to load: ${m.error}`); }
  }), []);
  useEffect(() => () => { voiceRef.current = false; agent.current?.stop(); }, []);
  useEffect(() => { reset(); }, [bot.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Publish the bot to the optional local runtime server (npm run server) so the REST API mirrors the console.
  useEffect(() => {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || runtimeServerDown) return;
    const t = setTimeout(() => fetch('http://localhost:8787/admin/bots', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bot) }).catch(() => { runtimeServerDown = true; }), 600);
    return () => clearTimeout(t);
  }, [bot]);

  function reset() {
    session.current = newSession();
    setMessages([]);
    setInspect(null);
    setError('');
  }

  async function send(text, extra = {}) {
    const { settings: st, mode: md, alias: al, bot: b } = latest.current;
    const { def, version } = resolveAlias(b, al);
    if (Date.now() - lastTurn.current > (def.idleSessionTTL || 300) * 1000) session.current = newSession();
    lastTurn.current = Date.now();
    const inputMode = extra.inputMode || 'Text';
    if (md !== 'classic' && !st.groqApiKey?.trim()) {
      setError('Groq API Key is required for LLM mode. Enter your key in AI Settings or switch to Classic.');
      setMessages((m) => [
        ...m,
        { role: 'user', text, inputMode, sttMs: extra.sttMs, sttEngine: extra.sttEngine },
        {
          role: 'bot',
          text: '⚠️ Groq API key is required for LLM mode. Please click the "Groq Key Needed" button in the top bar or open AI Settings to enter your free Groq API key. Alternatively, switch to "Classic" mode above.',
          error: true,
        },
      ]);
      return null;
    }
    setMessages((m) => [...m, { role: 'user', text, inputMode, sttMs: extra.sttMs, sttEngine: extra.sttEngine }]);
    setBusy(true);
    setError('');
    if (voiceRef.current) setVstate('thinking');
    try {
      const res = await recognizeText(def, session.current, text, {
        nluMode: md === 'classic' ? 'classic' : 'llm', llmSettings: st, runCodeHook, aliasName: al, version, inputMode,
      });
      const meta = res._voxlex;
      if (meta.error) setError(meta.error);
      const classic = md === 'compare' ? classicInterpret(def, text)[0] : null;
      const reply = res.messages.map((x) => x.content).join(' ');
      const turn = { inputMode, audioSec: extra.audioSec, ttsChars: inputMode === 'Speech' ? reply.length : 0, lambda: meta.lambdaMs != null, text };
      const cost = turnCost(turn).total;
      const bytes = turnBytes(turn);
      const it = res.sessionState.intent;
      actions.log(b.id, {
        ts: Date.now(), sessionId: res.sessionId, alias: al, text, inputMode, nlu: meta.nlu, model: meta.model,
        intent: it?.name, confidence: res.interpretations[0]?.nluConfidence?.score ?? null, state: it?.state,
        dialogAction: res.sessionState.dialogAction.type, slotToElicit: res.sessionState.dialogAction.slotToElicit,
        missed: !!meta.missed, totalMs: meta.totalMs, sttMs: extra.sttMs, cost, bytes,
        leakedBytes: inputMode === 'Speech' && extra.sttEngine === 'browser' ? bytes : 0,
      });
      setMessages((m) => [...m, { role: 'bot', text: reply, res, meta, classic, cost, sttMs: extra.sttMs }]);
      return res;
    } catch (e) {
      setError(e.message);
      setMessages((m) => [...m, { role: 'bot', text: 'Error: ' + e.message, error: true }]);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const submit = (e) => {
    e?.preventDefault();
    const t = input.trim();
    if (!t || busy) return;
    setInput('');
    send(t);
  };

  // ---- Voice loop --------------------------------------------------------------
  async function startVoice() {
    setError('');
    try {
      agent.current ||= new VoiceAgent({ onLevel: (l) => { level.current = l; }, onState: setVstate });
      await agent.current.start();
    } catch (e) {
      setError(`Microphone unavailable: ${e.message}`);
      return;
    }
    if (latest.current.settings.stt === 'whisper') preloadWhisper(latest.current.settings.whisperModel);
    voiceRef.current = true;
    setVoiceOn(true);
    const st = latest.current.settings;
    if (messages.length === 0 && bot.welcome) {
      setMessages((m) => [...m, { role: 'bot', text: bot.welcome, welcome: true }]);
      await agent.current.speak(bot.welcome, { voiceName: st.voice, bargeIn: st.bargeIn });
    }
    voiceLoop();
  }

  function stopVoice() {
    voiceRef.current = false;
    agent.current?.cancelListen();
    agent.current?.stop();
    agent.current = null;
    setVoiceOn(false);
    setVstate('off');
  }

  async function voiceLoop() {
    while (voiceRef.current) {
      const st = latest.current.settings;
      let text = '';
      let sttMs;
      let audioSec;
      // Until Whisper has finished downloading, fall back to the browser's recogniser so voice works immediately.
      if (st.stt === 'whisper' && whisperStatus(st.whisperModel).state === 'error') preloadWhisper(st.whisperModel); // resume download
      const whisperReady = whisperStatus(st.whisperModel).state === 'ready';
      const hasBrowserSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      const engine = st.stt === 'browser' || (!whisperReady && hasBrowserSR) ? 'browser' : 'whisper';
      try {
        if (engine === 'browser') {
          setVstate('listening');
          const t0 = performance.now();
          const r = await browserRecognize();
          text = r.text;
          sttMs = r.ms;
          audioSec = (performance.now() - t0) / 1000;
        } else {
          const rec = await agent.current.listen();
          if (!voiceRef.current) break;
          if (!rec) { if (st.handsFree) continue; break; }
          setVstate('transcribing');
          const r = await transcribeWhisper(rec.audio, st.whisperModel);
          text = r.text;
          sttMs = r.ms;
          audioSec = rec.seconds;
        }
      } catch (e) {
        setError(`Speech recognition failed: ${e.message}`);
        break;
      }
      if (!voiceRef.current) break;
      text = text.replace(/\[[^\]]*\]|\([^)]*\)/g, '').trim();
      if (!text || text.length < 2) continue;

      const res = await send(text, { inputMode: 'Speech', sttMs, audioSec, sttEngine: engine });
      if (!voiceRef.current || !res) break;
      const reply = res.messages.map((x) => x.content).join(' ');
      const { interrupted } = await agent.current.speak(reply, { voiceName: st.voice, bargeIn: st.bargeIn });
      if (interrupted) {
        setMessages((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, interrupted: true } : x)));
        continue;
      }
      if (!st.handsFree) break;
    }
    if (voiceRef.current) stopVoice();
  }

  const last = [...messages].reverse().find((m) => m.res);
  const live = last?.res.sessionState;
  const liveDef = live?.intent?.name && bot.intents.find((i) => i.name === live.intent.name);
  const aliasOpts = bot.aliases;

  return (
    <aside className="w-full sm:w-[440px] shrink-0 bg-white border-l border-line flex flex-col slide-in fixed sm:static inset-0 top-12 z-40">
      {/* Header */}
      <div className="px-4 py-3 border-b border-line flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-bold">Test {bot.name}</div>
          <select value={alias} onChange={(e) => { setAlias(e.target.value); reset(); }} className="text-xs text-muted bg-transparent outline-none">
            {aliasOpts.map((a) => <option key={a.name} value={a.name}>{a.name} → {a.version === 'DRAFT' ? 'Draft' : `Version ${a.version}`}</option>)}
          </select>
        </div>
        <button title="Inspect last response" onClick={() => setInspect(inspect ? null : last?.res)} className={cx('p-1.5 rounded hover:bg-gray-100', inspect && 'text-link')}><Braces size={17} /></button>
        <button title="Reset session" onClick={reset} className="p-1.5 rounded hover:bg-gray-100 text-muted"><RotateCcw size={16} /></button>
        <button title="Close" onClick={() => { stopVoice(); onClose(); }} className="p-1.5 rounded hover:bg-gray-100 text-muted"><X size={18} /></button>
      </div>

      {/* NLU mode switch */}
      <div className="px-4 py-2.5 border-b border-line bg-gray-50/70">
        <div className="grid grid-cols-3 gap-1 bg-gray-200/70 rounded-lg p-0.5">
          {NLU_MODES.map((m) => (
            <button key={m.key} title={m.hint} onClick={() => setMode(m.key)} className={cx('flex items-center justify-center gap-1.5 text-xs font-semibold py-1.5 rounded-md', mode === m.key ? 'bg-white shadow text-ink' : 'text-muted hover:text-ink')}>
              <m.icon size={13} />{m.label}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-muted mt-1.5 flex items-center gap-1">
          {mode === 'classic' ? (
            <>Sample-utterance matching · threshold {bot.nluThreshold}</>
          ) : (
            <>
              <Sparkles size={11} className={settings.groqApiKey ? 'text-action' : 'text-amber-500'} />
              <span>Groq · {settings.groqModel || 'llama-3.3-70b-versatile'}</span>
              {!settings.groqApiKey && (
                <span className="text-amber-600 font-semibold ml-1">(key needed)</span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Live dialog state */}
      {live?.intent?.name && liveDef && (
        <div className="px-4 py-2 border-b border-line text-xs">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-semibold font-mono">{live.intent.name}</span>
            <Badge tone={live.intent.state === 'Fulfilled' ? 'green' : live.intent.state === 'Failed' ? 'red' : 'blue'}>{live.intent.state}</Badge>
            <span className="text-muted ml-auto">{live.dialogAction.type}{live.dialogAction.slotToElicit ? ` · ${live.dialogAction.slotToElicit}` : ''}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {liveDef.slots.map((s) => {
              const v = live.intent.slots?.[s.name]?.value?.interpretedValue;
              const asking = live.dialogAction.slotToElicit === s.name;
              return (
                <span key={s.name} className={cx('px-2 py-0.5 rounded-full border', v ? 'bg-green-50 border-green-300 text-ok' : asking ? 'border-action text-action-dark bg-orange-50' : 'border-line text-muted')}>
                  {s.name}{v ? `: ${v}` : asking ? ' ?' : ''}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Transcript */}
      <div ref={listRef} className="flex-1 overflow-y-auto scroll-thin px-4 py-4 space-y-3 bg-[#fafbfb]">
        {messages.length === 0 && (
          <div className="text-center text-muted text-sm mt-8 px-6">
            <div className="w-12 h-12 rounded-full bg-orange-50 text-action flex items-center justify-center mx-auto mb-3"><Mic size={22} /></div>
            Type a message, or tap the mic for a hands-free voice conversation.
            <div className="mt-4 space-y-1.5">
              {(bot.name === 'PizzaBot'
                ? ['yo get me two big paneer pizzas around 8 tonight', 'order a large pepperoni pizza', 'where is my order PZ4421']
                : bot.intents.slice(0, 3).map((i) => i.utterances[0]).filter(Boolean)
              ).map((s) => <button key={s} onClick={() => send(s)} className="block mx-auto text-xs rounded-full border border-line bg-white px-3 py-1 hover:border-link hover:text-link">“{s}”</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => (m.role === 'user' ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%]">
              <div className="bg-link text-white rounded-2xl rounded-br-md px-3.5 py-2 text-sm">{m.text}</div>
              {m.inputMode === 'Speech' && <div className="text-[10.5px] text-muted text-right mt-0.5 flex items-center justify-end gap-1"><Mic size={10} /> {m.sttEngine === 'browser' ? 'browser speech API' : 'Whisper, on-device'}{m.sttMs ? ` · ${m.sttMs} ms` : ''}</div>}
            </div>
          </div>
        ) : (
          <div key={i} className="flex">
            <div className="max-w-[90%]">
              <div className={cx('rounded-2xl rounded-bl-md px-3.5 py-2 text-sm border', m.error ? 'bg-red-50 border-red-200 text-bad' : 'bg-white border-line')}>
                {m.text}
                {m.interrupted && <span className="ml-1.5 text-[10px] font-semibold text-violet-700 bg-violet-50 rounded px-1">✋ interrupted</span>}
              </div>
              {m.meta && (
                <div className="text-[10.5px] text-muted mt-1 flex flex-wrap gap-x-2 gap-y-0.5 items-center">
                  <span className="font-mono">{m.res.interpretations[0]?.intent.name}</span>
                  {m.res.interpretations[0]?.nluConfidence && <span>conf {m.res.interpretations[0].nluConfidence.score.toFixed(2)}</span>}
                  <Badge tone={m.meta.nlu === 'llm' ? 'purple' : 'gray'} className="!text-[9.5px] !py-0">{m.meta.nlu === 'llm' ? 'LLM' : 'Classic'}</Badge>
                  <span>{m.meta.llmMs ? `NLU ${m.meta.llmMs} ms` : `${m.meta.totalMs} ms`}</span>
                  {m.meta.lambdaMs != null && <span>λ {m.meta.lambdaMs} ms</span>}
                  {m.meta.missed && <span className="text-bad font-semibold">missed</span>}
                  <span className="text-ok flex items-center gap-0.5"><ShieldCheck size={10} />{usd(m.cost)} saved</span>
                  <button className="text-link hover:underline" onClick={() => setInspect(m.res)}>JSON</button>
                </div>
              )}
              {m.meta?.rejectedSlots && <div className="text-[10.5px] text-amber-700 mt-0.5">Guard rejected unsupported slot value(s): {Object.entries(m.meta.rejectedSlots).map(([k, v]) => `${k}=${v}`).join(', ')}</div>}
              {m.classic && (
                <div className={cx('mt-1 text-[10.5px] rounded-md px-2 py-1 border', m.classic.intent === m.res.interpretations[0]?.intent.name && m.classic.confidence >= bot.nluThreshold ? 'border-line bg-gray-50 text-muted' : 'border-amber-300 bg-amber-50 text-amber-800')}>
                  Classic NLU would pick: <b className="font-mono">{m.classic.confidence >= bot.nluThreshold ? m.classic.intent : 'FallbackIntent'}</b> ({m.classic.confidence.toFixed(2)}) · slots {Object.keys(m.classic.slots).length ? Object.entries(m.classic.slots).map(([k, v]) => `${k}=${v}`).join(', ') : 'none'}
                </div>
              )}
              {m.meta?.lambdaLogs?.length > 0 && <details className="text-[10.5px] text-muted mt-0.5"><summary className="cursor-pointer">Lambda logs</summary><pre className="font-mono whitespace-pre-wrap">{m.meta.lambdaLogs.join('\n')}</pre></details>}
            </div>
          </div>
        )))}
        {busy && <div className="flex gap-1 px-2 text-muted"><span className="dot">●</span><span className="dot">●</span><span className="dot">●</span></div>}
      </div>

      {inspect && (
        <div className="border-t border-line max-h-[38%] flex flex-col">
          <div className="px-4 py-1.5 text-xs font-semibold flex items-center justify-between bg-gray-50">RecognizeText response <button onClick={() => setInspect(null)}><X size={14} /></button></div>
          <Code className="!rounded-none flex-1 overflow-auto">{JSON.stringify(inspect, null, 2)}</Code>
        </div>
      )}

      {error && <div className="px-4 py-2 text-xs bg-amber-50 text-amber-800 border-t border-amber-200">{error}</div>}

      {/* Voice / text input */}
      <div className="border-t border-line p-3">
        {voiceOn ? (
          <div className="flex items-center gap-3">
            <button onClick={stopVoice} className="w-12 h-12 rounded-full bg-bad text-white flex items-center justify-center shrink-0" title="End voice session"><CircleStop size={22} /></button>
            <div className="flex-1 min-w-0">
              <div className={cx('text-sm font-semibold', VSTATE[vstate]?.tone)}>{whisperMsg || VSTATE[vstate]?.label}</div>
              <LevelMeter level={level} active={vstate === 'listening' || vstate === 'speaking'} />
            </div>
            <div className={cx('w-3 h-3 rounded-full', vstate === 'listening' ? 'bg-action pulse-ring' : vstate === 'speaking' ? 'bg-ok' : 'bg-gray-300')} />
          </div>
        ) : (
          <form onSubmit={submit} className="flex items-center gap-2">
            <button type="button" onClick={startVoice} title="Start voice conversation" className="w-10 h-10 rounded-full bg-action hover:bg-action-dark text-white flex items-center justify-center shrink-0"><Mic size={18} /></button>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a message" className="flex-1 h-10 rounded-full border border-gray-400 px-4 text-sm outline-none focus:border-link focus:ring-2 focus:ring-link/25" />
            <button disabled={busy || !input.trim()} className="w-10 h-10 rounded-full bg-link text-white flex items-center justify-center disabled:opacity-40"><Send size={16} /></button>
          </form>
        )}
      </div>
    </aside>
  );
}

function LevelMeter({ level, active }) {
  const ref = useRef();
  useEffect(() => {
    let raf;
    const hist = new Array(40).fill(0);
    const draw = () => {
      const c = ref.current;
      if (c) {
        const ctx = c.getContext('2d');
        hist.push(active ? Math.min(1, level.current * 9) : 0);
        hist.shift();
        ctx.clearRect(0, 0, c.width, c.height);
        hist.forEach((v, i) => {
          const h = Math.max(2, v * c.height);
          ctx.fillStyle = '#ec7211';
          ctx.globalAlpha = 0.35 + 0.65 * (i / hist.length);
          ctx.fillRect(i * (c.width / hist.length), (c.height - h) / 2, c.width / hist.length - 2, h);
        });
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [active, level]);
  return <canvas ref={ref} width={280} height={26} className="w-full h-[26px] mt-1" />;
}
