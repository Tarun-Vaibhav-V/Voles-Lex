import { useState } from 'react';
import { CloudOff, ShieldCheck } from 'lucide-react';
import { useStore } from '../store.js';
import { PRICES, usd } from '../engine/cost.js';
import { Container, Field, Stat, Table } from '../components/ui.jsx';

const fmtBytes = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(2)} MB` : b > 1e3 ? `${(b / 1e3).toFixed(1)} KB` : `${b} B`);

export default function Dashboard() {
  const usage = useStore((s) => s.usage);
  const bots = useStore((s) => s.bots);
  const logs = useStore((s) => s.logs);
  const [perDay, setPerDay] = useState(500);
  const [voiceShare, setVoiceShare] = useState(60);
  const [turnsPerConv, setTurns] = useState(5);

  const all = Object.values(logs).flat();
  const leaked = all.reduce((n, l) => n + (l.leakedBytes || 0), 0);

  // Projection for a production deployment on AWS
  const reqs = perDay * 30 * turnsPerConv;
  const speech = reqs * (voiceShare / 100);
  const text = reqs - speech;
  const monthly = {
    lex: speech * PRICES.lexSpeech + text * PRICES.lexText,
    transcribe: speech * 15 * PRICES.transcribePerSec,
    polly: reqs * 80 * PRICES.pollyNeuralPerChar,
  };
  const total = monthly.lex + monthly.transcribe + monthly.polly;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Cost & privacy</h1>
        <p className="text-muted">What your conversations would have cost on AWS — and how much data would have left the device.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Turns processed locally" value={usage.turns} />
        <Stat label="AWS cost avoided" value={usd(usage.cost)} sub="Lex + Transcribe + Polly + Lambda" tone="green" />
        <Stat label="Data kept on device" value={fmtBytes(usage.bytes)} sub="audio + text never uploaded" tone="green" />
        <Stat label="Data sent to cloud" value={fmtBytes(leaked)} sub={leaked ? 'from browser speech API' : 'nothing — fully local'} tone={leaked ? 'orange' : 'green'} />
      </div>

      <Container title="Production projection" description="Estimate the monthly AWS bill if this bot ran on Amazon Lex in the cloud (us-east-1 list prices).">
        <div className="grid md:grid-cols-3 gap-5 mb-5">
          <Field label={`Conversations per day: ${perDay}`}><input type="range" min="10" max="10000" step="10" value={perDay} onChange={(e) => setPerDay(+e.target.value)} className="w-full accent-[#ec7211]" /></Field>
          <Field label={`Turns per conversation: ${turnsPerConv}`}><input type="range" min="1" max="15" value={turnsPerConv} onChange={(e) => setTurns(+e.target.value)} className="w-full accent-[#ec7211]" /></Field>
          <Field label={`Voice share: ${voiceShare}%`}><input type="range" min="0" max="100" value={voiceShare} onChange={(e) => setVoiceShare(+e.target.value)} className="w-full accent-[#ec7211]" /></Field>
        </div>
        <div className="grid md:grid-cols-2 gap-5 items-center">
          <div className="space-y-2.5">
            {[['Amazon Lex requests', monthly.lex], ['Amazon Transcribe (15 s min/turn)', monthly.transcribe], ['Amazon Polly neural (~80 chars/reply)', monthly.polly]].map(([k, v]) => (
              <div key={k}>
                <div className="flex justify-between text-sm"><span>{k}</span><span className="font-semibold tabular-nums">{usd(v)}</span></div>
                <div className="h-2 rounded-full bg-gray-100 mt-1"><div className="h-2 rounded-full bg-action" style={{ width: `${total ? (v / total) * 100 : 0}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="rounded-xl bg-gradient-to-br from-squid to-[#0f1b2a] text-white p-5">
            <div className="text-sm text-gray-300">AWS cloud, per month</div>
            <div className="text-3xl font-bold tabular-nums">{usd(total)}</div>
            <div className="text-sm text-gray-300 mt-3">VoxLex on-device</div>
            <div className="text-3xl font-bold text-smile flex items-center gap-2">$0.00 <CloudOff size={22} /></div>
            <div className="text-xs text-gray-400 mt-2">{reqs.toLocaleString()} requests/month · {usd(total * 12)} saved per year</div>
          </div>
        </div>
      </Container>

      <Container title="Per bot" padded={false}>
        <Table
          columns={[
            { key: 'name', label: 'Bot' },
            { key: 'turns', label: 'Turns' },
            { key: 'voice', label: 'Voice turns' },
            { key: 'cost', label: 'AWS equivalent', render: (r) => usd(r.cost) },
            { key: 'private', label: 'Privacy', render: (r) => <span className="flex items-center gap-1 text-ok text-xs font-semibold"><ShieldCheck size={13} />{r.leaked ? 'Partially local' : 'Fully local'}</span> },
          ]}
          rows={bots.map((b) => {
            const l = logs[b.id] || [];
            return { id: b.id, name: b.name, turns: l.length, voice: l.filter((x) => x.inputMode === 'Speech').length, cost: l.reduce((n, x) => n + (x.cost || 0), 0), leaked: l.some((x) => x.leakedBytes) };
          })}
        />
      </Container>
    </div>
  );
}
