import { useState } from 'react';
import { Check, Mic, Sparkles, Trash2, Type } from 'lucide-react';
import { actions, useStore } from '../store.js';
import { analytics, coachSuggestions } from '../engine/coach.js';
import { makeIntent } from '../engine/templates.js';
import { Alert, Badge, Button, Container, Stat, Table } from '../components/ui.jsx';

const EMPTY = [];

export default function Analytics({ bot }) {
  const logs = useStore((s) => s.logs[bot.id]) || EMPTY;
  const settings = useStore((s) => s.settings);
  const [sugs, setSugs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [applied, setApplied] = useState({});
  const a = analytics(logs);
  const missed = logs.filter((l) => l.missed);

  const coach = async () => {
    setBusy(true); setErr('');
    try { setSugs(await coachSuggestions(settings, bot, missed)); setApplied({}); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const apply = (s, k) => {
    actions.updateBot(bot.id, (b) => {
      if (s.intent === 'NewIntent') {
        const name = (s.newIntentName || 'NewIntent').replace(/\W/g, '');
        if (b.intents.some((i) => i.name === name)) return { ...b, intents: b.intents.map((i) => (i.name === name ? { ...i, utterances: [...i.utterances, s.utterance] } : i)) };
        return { ...b, intents: [...b.intents, makeIntent({ name, description: s.reason, utterances: [s.utterance], closingResponse: 'Got it.' })] };
      }
      return { ...b, intents: b.intents.map((i) => {
        if (i.name !== s.intent) return i;
        const names = new Set(i.slots.map((x) => x.name));
        const ok = [...(s.templated || '').matchAll(/\{(\w+)\}/g)].every((m) => names.has(m[1]));
        const u = ok && s.templated ? s.templated : s.utterance;
        return i.utterances.includes(u) ? i : { ...i, utterances: [...i.utterances, u] };
      }) };
    });
    setApplied((x) => ({ ...x, [k]: true }));
  };

  const nluRow = (k) => a.byNlu[k]?.n ? `${Math.round((a.byNlu[k].missed / a.byNlu[k].n) * 100)}% missed · ${Math.round(a.byNlu[k].ms / a.byNlu[k].n)} ms avg` : 'no turns yet';

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Turns" value={a.turns} sub="conversation turns logged" />
        <Stat label="Fulfilled" value={a.fulfilled} sub="intents completed" tone="green" />
        <Stat label="Missed utterances" value={a.missed} sub={`${Math.round(a.missRate * 100)}% of turns`} tone="orange" />
        <Stat label="Classic vs LLM" value={<span className="text-base leading-6 block">Classic: {nluRow('classic')}<br />LLM: {nluRow('llm')}</span>} />
      </div>

      <Container
        title="Missed-utterance coach"
        description="Your local LLM reviews what users said that the bot failed to understand and proposes training-data fixes. One click applies them."
        actions={<Button variant="primary" icon={Sparkles} disabled={busy || !missed.length} onClick={coach}>{busy ? 'Analysing…' : `Analyse ${missed.length} missed`}</Button>}
      >
        {err && <Alert tone="error" className="mb-3">{err}</Alert>}
        {!missed.length && <p className="text-muted text-sm">No missed utterances yet. Chat with the bot in <b>Classic NLU</b> mode using unusual phrasings to generate some.</p>}
        {missed.length > 0 && !sugs && <p className="text-muted text-sm">{missed.length} missed utterance(s) waiting for analysis.</p>}
        {sugs && (
          <div className="space-y-2">
            {sugs.length === 0 && <p className="text-muted text-sm">No suggestions.</p>}
            {sugs.map((s, k) => (
              <div key={k} className="border border-line rounded-lg p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm">"{s.utterance}"</div>
                  <div className="text-xs text-muted mt-1 flex flex-wrap items-center gap-1.5">
                    → <Badge tone={s.intent === 'Ignore' ? 'gray' : s.intent === 'NewIntent' ? 'purple' : 'blue'}>{s.intent === 'NewIntent' ? `New intent: ${s.newIntentName}` : s.intent}</Badge>
                    {s.templated && s.intent !== 'Ignore' && <code className="font-mono bg-gray-100 rounded px-1">{s.templated}</code>}
                    <span>· {s.reason}</span>
                  </div>
                </div>
                {s.intent !== 'Ignore' && (applied[k]
                  ? <Badge tone="green"><Check size={11} /> Added</Badge>
                  : <Button size="sm" onClick={() => apply(s, k)}>Add utterance</Button>)}
              </div>
            ))}
          </div>
        )}
      </Container>

      <Container title="Conversation logs" description="Every turn, as Lex would write to CloudWatch conversation logs — kept locally." padded={false}
        actions={<Button variant="ghost" icon={Trash2} onClick={() => { actions.clearLogs(bot.id); setSugs(null); }}>Clear</Button>}>
        <Table
          columns={[
            { key: 'ts', label: 'Time', render: (l) => <span className="text-muted whitespace-nowrap text-xs">{new Date(l.ts).toLocaleTimeString()}</span> },
            { key: 'mode', label: '', render: (l) => (l.inputMode === 'Speech' ? <Mic size={14} className="text-action" /> : <Type size={14} className="text-muted" />) },
            { key: 'text', label: 'User input', render: (l) => <span className={l.missed ? 'text-bad' : ''}>{l.text}</span> },
            { key: 'intent', label: 'Intent', render: (l) => <span className="font-mono text-xs">{l.intent || '—'}</span> },
            { key: 'conf', label: 'Conf.', render: (l) => (l.confidence != null ? l.confidence.toFixed(2) : '—') },
            { key: 'nlu', label: 'NLU', render: (l) => <Badge tone={l.nlu === 'llm' ? 'purple' : 'gray'}>{l.nlu === 'llm' ? 'LLM' : 'Classic'}</Badge> },
            { key: 'state', label: 'Dialog action', render: (l) => <span className="text-xs">{l.dialogAction}{l.slotToElicit ? ` · ${l.slotToElicit}` : ''}</span> },
            { key: 'ms', label: 'Latency', render: (l) => <span className="text-xs tabular-nums">{l.totalMs} ms</span> },
          ]}
          rows={[...logs].reverse().slice(0, 200).map((l, i) => ({ ...l, id: i }))}
          empty="No conversations yet — open the Test console."
        />
      </Container>
    </div>
  );
}
