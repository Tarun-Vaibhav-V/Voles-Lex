import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { actions } from '../store.js';
import { go } from '../router.js';
import { BUILTIN_SLOT_TYPES } from '../engine/slotTypes.js';
import { Badge, Button, Container, Field, Input, Table, Toggle } from '../components/ui.jsx';

export default function SlotTypes({ bot, selected }) {
  const current = selected && bot.slotTypes.find((t) => t.name === decodeURIComponent(selected));
  const update = (name, patch) => actions.updateBot(bot.id, (b) => ({ ...b, slotTypes: b.slotTypes.map((t) => (t.name === name ? { ...t, ...patch } : t)) }));

  const add = () => {
    let n = 1;
    while (bot.slotTypes.some((t) => t.name === `CustomType${n}`)) n++;
    const name = `CustomType${n}`;
    actions.updateBot(bot.id, (b) => ({ ...b, slotTypes: [...b.slotTypes, { name, description: '', resolution: 'restrict', values: [] }] }));
    go(`bots/${bot.id}/slottypes/${name}`);
  };

  if (current) return <SlotTypeEditor bot={bot} type={current} update={(p) => update(current.name, p)} />;

  return (
    <div className="space-y-5">
      <Container title={`Custom slot types (${bot.slotTypes.length})`} description="Define the values a slot can take, with synonyms." actions={<Button variant="primary" icon={Plus} onClick={add}>Add slot type</Button>} padded={false}>
        <Table
          onRowClick={(t) => go(`bots/${bot.id}/slottypes/${encodeURIComponent(t.name)}`)}
          columns={[
            { key: 'name', label: 'Name', render: (t) => <span className="text-link font-semibold">{t.name}</span> },
            { key: 'values', label: 'Values', render: (t) => <div className="flex flex-wrap gap-1">{t.values.slice(0, 6).map((v) => <Badge key={v.value}>{v.value}</Badge>)}{t.values.length > 6 && <span className="text-muted text-xs">+{t.values.length - 6}</span>}</div> },
            { key: 'res', label: 'Resolution', render: (t) => (t.resolution === 'expand' ? 'Expand values' : 'Restrict to values') },
            {
              key: 'x', label: '', render: (t) => (
                <button className="text-muted hover:text-bad" onClick={(e) => {
                  e.stopPropagation();
                  const used = bot.intents.some((i) => i.slots.some((s) => s.type === t.name));
                  if (used) return alert('This slot type is used by a slot. Change those slots first.');
                  actions.updateBot(bot.id, (b) => ({ ...b, slotTypes: b.slotTypes.filter((x) => x.name !== t.name) }));
                }}><Trash2 size={15} /></button>
              ),
            },
          ]}
          rows={bot.slotTypes.map((t) => ({ ...t, id: t.name }))}
          empty="No custom slot types."
        />
      </Container>
      <Container title="Built-in slot types" description="Available to every bot (AMAZON.* equivalents)." padded={false}>
        <Table columns={[{ key: 'id', label: 'Name', render: (r) => <code className="font-mono text-[12.5px]">{r.id}</code> }, { key: 'description', label: 'Recognises' }]} rows={Object.entries(BUILTIN_SLOT_TYPES).map(([id, t]) => ({ id, description: t.description }))} />
      </Container>
    </div>
  );
}

function SlotTypeEditor({ bot, type, update }) {
  const [value, setValue] = useState('');
  const [syn, setSyn] = useState('');
  const [name, setName] = useState(type.name);

  const rename = () => {
    const n = name.replace(/\W/g, '');
    if (!n || n === type.name || bot.slotTypes.some((t) => t.name === n)) return setName(type.name);
    actions.updateBot(bot.id, (b) => ({
      ...b,
      slotTypes: b.slotTypes.map((t) => (t.name === type.name ? { ...t, name: n } : t)),
      intents: b.intents.map((i) => ({ ...i, slots: i.slots.map((s) => (s.type === type.name ? { ...s, type: n } : s)) })),
    }));
    go(`bots/${bot.id}/slottypes/${n}`);
  };

  const addValue = () => {
    if (!value.trim()) return;
    update({ values: [...type.values, { value: value.trim(), synonyms: syn.split(',').map((s) => s.trim()).filter(Boolean) }] });
    setValue(''); setSyn('');
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">{type.name}</h1><Button onClick={() => go(`bots/${bot.id}/slottypes`)}>Back</Button></div>
      <Container title="Slot type details">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} /></Field>
          <Field label="Description"><Input value={type.description} onChange={(e) => update({ description: e.target.value })} /></Field>
        </div>
        <div className="mt-4">
          <Toggle checked={type.resolution === 'expand'} onChange={(v) => update({ resolution: v ? 'expand' : 'restrict' })} label={type.resolution === 'expand' ? 'Expand values — accept values similar to the list' : 'Restrict to slot values and synonyms'} />
        </div>
      </Container>
      <Container title={`Slot values (${type.values.length})`}>
        <div className="grid md:grid-cols-[1fr_2fr_auto] gap-2 mb-3">
          <Input placeholder="Value (e.g. Large)" value={value} onChange={(e) => setValue(e.target.value)} />
          <Input placeholder="Synonyms, comma separated (e.g. big, family size)" value={syn} onChange={(e) => setSyn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addValue()} />
          <Button icon={Plus} onClick={addValue}>Add value</Button>
        </div>
        <div className="border border-line/70 rounded-lg divide-y divide-line/70">
          {type.values.map((v, n) => (
            <div key={n} className="flex items-center gap-3 px-3 py-2">
              <span className="font-semibold w-40 shrink-0">{v.value}</span>
              <div className="flex-1 flex flex-wrap gap-1">{v.synonyms.map((s) => <Badge key={s}>{s}</Badge>)}</div>
              <button className="text-muted hover:text-bad" onClick={() => update({ values: type.values.filter((_, k) => k !== n) })}><X size={15} /></button>
            </div>
          ))}
          {type.values.length === 0 && <div className="text-muted text-sm p-3">No values yet.</div>}
        </div>
      </Container>
    </div>
  );
}
