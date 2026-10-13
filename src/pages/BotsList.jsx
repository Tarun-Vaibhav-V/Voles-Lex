import { useRef, useState } from 'react';
import { Bot, FileUp, LayoutTemplate, Plus, Sparkles, Trash2, Wand2, Mic, ShieldCheck, Cpu } from 'lucide-react';
import { actions, useStore } from '../store.js';
import { go } from '../router.js';
import { TEMPLATES, makeBot } from '../engine/templates.js';
import { generateBot } from '../engine/generator.js';
import { Alert, Badge, Button, Container, Field, Input, Modal, Table, Textarea, cx } from '../components/ui.jsx';

const IDEAS = [
  'A college canteen bot that takes food orders with item, quantity and pickup time',
  'A clinic receptionist that books doctor appointments by department, date and patient name',
  'A cab booking assistant: pickup city, drop city, date, time and car type',
  'A library bot to reserve books by title and check due dates by member id',
];

export default function BotsList() {
  const bots = useStore((s) => s.bots);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-br from-squid to-[#0f1b2a] text-white p-6 md:p-8 relative overflow-hidden">
        <div className="absolute -right-10 -top-10 w-64 h-64 rounded-full bg-smile/10 blur-2xl" />
        <div className="relative max-w-3xl">
          <Badge tone="orange" className="!bg-smile/15 !text-smile !border-smile/40">Amazon Lex V2 · re-imagined local-first</Badge>
          <h1 className="text-2xl md:text-3xl font-bold mt-3 tracking-tight">Build voice & chat bots that run entirely on your machine.</h1>
          <p className="text-gray-300 mt-2 leading-relaxed">
            VoxLex re-implements the Lex bot builder and runtime — intents, slots, dialog management, Lambda fulfillment, versions & aliases —
            and adds an on-device LLM + Whisper voice agent. No cloud round-trips, no per-request bill.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-5 text-[13px] text-gray-200">
            <span className="flex items-center gap-1.5"><Cpu size={15} className="text-smile" /> Gemma / Qwen via Ollama</span>
            <span className="flex items-center gap-1.5"><Mic size={15} className="text-smile" /> Whisper STT + barge-in</span>
            <span className="flex items-center gap-1.5"><ShieldCheck size={15} className="text-smile" /> 0 bytes leave the device</span>
          </div>
        </div>
      </div>

      <Container
        title={`Bots (${bots.length})`}
        description="A bot performs automated tasks such as ordering a pizza or booking a hotel."
        actions={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Create bot</Button>}
        padded={false}
      >
        <Table
          onRowClick={(b) => go(`bots/${b.id}/intents`)}
          columns={[
            { key: 'name', label: 'Name', render: (b) => <span className="text-link font-semibold flex items-center gap-2"><Bot size={15} />{b.name}</span> },
            { key: 'description', label: 'Description', render: (b) => <span className="text-muted line-clamp-2">{b.description || '—'}</span> },
            { key: 'intents', label: 'Intents', render: (b) => b.intents.length },
            { key: 'versions', label: 'Latest version', render: (b) => b.versions.at(-1)?.version ? `Version ${b.versions.at(-1).version}` : <span className="text-muted">Draft only</span> },
            { key: 'status', label: 'Status', render: () => <Badge tone="green">Available</Badge> },
            { key: 'updated', label: 'Last edited', render: (b) => <span className="text-muted whitespace-nowrap">{new Date(b.updatedAt).toLocaleString()}</span> },
            {
              key: 'x', label: '', render: (b) => (
                <button title="Delete bot" className="text-muted hover:text-bad" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete ${b.name}? This cannot be undone.`)) actions.deleteBot(b.id); }}>
                  <Trash2 size={15} />
                </button>
              ),
            },
          ]}
          rows={bots}
          empty="No bots yet — create one to get started."
        />
      </Container>

      {creating && <CreateBotModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateBotModal({ onClose }) {
  const settings = useStore((s) => s.settings);
  const [mode, setMode] = useState('ai');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [tpl, setTpl] = useState('PizzaBot');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef();

  const done = (bot) => { const id = actions.addBot(bot); onClose(); go(`bots/${id}/intents`); };

  async function create() {
    setErr('');
    if (mode === 'blank') {
      if (!/^[A-Za-z][\w-]{0,99}$/.test(name)) return setErr('Name must start with a letter and contain only letters, numbers, _ or -.');
      return done(makeBot({ name, description: desc }));
    }
    if (mode === 'template') return done(TEMPLATES[tpl]());
    if (mode === 'ai') {
      if (desc.trim().length < 10) return setErr('Describe your bot in at least one sentence.');
      setBusy(true);
      try {
        const { bot } = await generateBot(settings, desc);
        if (!bot.intents.length) throw new Error('The model returned no intents — try again or use a bigger model.');
        done(bot);
      } catch (e) { setErr(e.message); } finally { setBusy(false); }
    }
  }

  function importFile(f) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const b = JSON.parse(r.result);
        if (!b.intents || !b.name) throw new Error('Not a VoxLex bot export');
        done(makeBot({ ...b, id: undefined, versions: [], aliases: undefined }));
      } catch (e) { setErr(e.message); }
    };
    r.readAsText(f);
  }

  const tabs = [
    { key: 'ai', label: 'Describe with AI', icon: Sparkles, tag: 'New' },
    { key: 'template', label: 'Start from example', icon: LayoutTemplate },
    { key: 'blank', label: 'Blank bot', icon: Plus },
    { key: 'import', label: 'Import', icon: FileUp },
  ];

  return (
    <Modal
      title="Create bot"
      onClose={onClose}
      wide
      footer={<>
        <Button variant="link" onClick={onClose}>Cancel</Button>
        {mode !== 'import' && <Button variant="primary" icon={mode === 'ai' ? Wand2 : undefined} disabled={busy} onClick={create}>{busy ? 'Generating with local LLM…' : mode === 'ai' ? 'Generate bot' : 'Create'}</Button>}
      </>}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-5">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setMode(t.key)} className={cx('rounded-lg border p-3 text-left text-sm', mode === t.key ? 'border-link bg-blue-50/60 ring-1 ring-link' : 'border-line hover:border-gray-400')}>
            <t.icon size={17} className={mode === t.key ? 'text-link' : 'text-muted'} />
            <div className="font-semibold mt-1.5 flex items-center gap-1.5">{t.label}{t.tag && <Badge tone="purple">{t.tag}</Badge>}</div>
          </button>
        ))}
      </div>

      {mode === 'ai' && (
        <div className="space-y-3">
          <Field label="Describe what your bot should do" hint={`Your local model (${settings.provider === 'webllm' ? settings.webllmModel : settings.model}) designs the intents, slots, slot types, utterances and prompts.`}>
            <Textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. A bot for a college canteen that takes food orders…" />
          </Field>
          <div className="flex flex-wrap gap-2">
            {IDEAS.map((i) => <button key={i} onClick={() => setDesc(i)} className="text-xs rounded-full border border-line px-3 py-1 hover:border-link hover:text-link text-left">{i}</button>)}
          </div>
        </div>
      )}
      {mode === 'template' && (
        <div className="grid md:grid-cols-2 gap-3">
          {Object.keys(TEMPLATES).map((k) => {
            const b = TEMPLATES[k]();
            return (
              <button key={k} onClick={() => setTpl(k)} className={cx('rounded-lg border p-4 text-left', tpl === k ? 'border-link ring-1 ring-link bg-blue-50/40' : 'border-line')}>
                <div className="font-semibold">{b.name}</div>
                <div className="text-xs text-muted mt-1">{b.description}</div>
                <div className="text-xs mt-2 flex flex-wrap gap-1">{b.intents.map((i) => <Badge key={i.id}>{i.name}</Badge>)}</div>
              </button>
            );
          })}
        </div>
      )}
      {mode === 'blank' && (
        <div className="space-y-3">
          <Field label="Bot name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="OrderFlowers" /></Field>
          <Field label="Description - optional"><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        </div>
      )}
      {mode === 'import' && (
        <div className="border-2 border-dashed border-line rounded-xl p-8 text-center">
          <FileUp className="mx-auto text-muted" />
          <p className="text-sm mt-2">Import a VoxLex bot JSON export</p>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files[0] && importFile(e.target.files[0])} />
          <Button className="mt-3" onClick={() => fileRef.current.click()}>Choose file</Button>
        </div>
      )}
      {err && <Alert tone="error" className="mt-4">{err}</Alert>}
    </Modal>
  );
}
