import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { actions } from '../store.js';
import { go } from '../router.js';
import { makeIntent } from '../engine/templates.js';
import { Alert, Badge, Button, Container, Field, Input, Modal, Table } from '../components/ui.jsx';

export default function Intents({ bot }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const add = () => {
    if (!/^[A-Za-z][\w]*$/.test(name) || bot.intents.some((i) => i.name === name)) return;
    const intent = makeIntent({ name });
    actions.updateBot(bot.id, (b) => ({ ...b, intents: [...b.intents, intent] }));
    setAdding(false);
    go(`bots/${bot.id}/intents/${intent.id}`);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{bot.name}</h1>
        <p className="text-muted">{bot.description}</p>
      </div>
      {bot.intents.every((i) => i.utterances.length < 5) && bot.intents.length > 0 && (
        <Alert tone="info">
          <b>Tip:</b> Classic Lex needs ~10+ sample utterances per intent to understand users well. With <b>LLM NLU</b> enabled in the test console, a couple of examples is enough — try both and compare.
        </Alert>
      )}
      <Container
        title={`Intents (${bot.intents.length + 1})`}
        description="An intent represents an action that the user wants to perform."
        actions={<Button variant="primary" icon={Plus} onClick={() => { setName(''); setAdding(true); }}>Add intent</Button>}
        padded={false}
      >
        <Table
          onRowClick={(i) => i.id !== 'fallback' && go(`bots/${bot.id}/intents/${i.id}`)}
          columns={[
            { key: 'name', label: 'Name', render: (i) => <span className={i.id === 'fallback' ? 'font-semibold' : 'text-link font-semibold'}>{i.name}</span> },
            { key: 'description', label: 'Description', render: (i) => <span className="text-muted">{i.description || '—'}</span> },
            { key: 'u', label: 'Utterances', render: (i) => i.utterances?.length ?? '—' },
            { key: 's', label: 'Slots', render: (i) => <div className="flex flex-wrap gap-1">{i.slots?.length ? i.slots.map((s) => <Badge key={s.name} tone="blue">{s.name}</Badge>) : <span className="text-muted">—</span>}</div> },
            { key: 'f', label: 'Fulfillment', render: (i) => (i.id === 'fallback' ? <Badge>Built-in</Badge> : i.fulfillmentEnabled ? <Badge tone="orange">Lambda</Badge> : <Badge>Closing response</Badge>) },
            {
              key: 'x', label: '', render: (i) => i.id !== 'fallback' && (
                <button title="Delete" className="text-muted hover:text-bad" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete intent ${i.name}?`)) actions.updateBot(bot.id, (b) => ({ ...b, intents: b.intents.filter((x) => x.id !== i.id) })); }}>
                  <Trash2 size={15} />
                </button>
              ),
            },
          ]}
          rows={[...bot.intents, { id: 'fallback', name: 'FallbackIntent', description: 'Default intent when no other intent matches (AMAZON.FallbackIntent)' }]}
        />
      </Container>

      {adding && (
        <Modal title="Add intent" onClose={() => setAdding(false)} footer={<><Button variant="link" onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" onClick={add}>Add</Button></>}>
          <Field label="Intent name" hint="Letters, numbers and underscores. Must be unique.">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="BookFlight" />
          </Field>
          {bot.intents.some((i) => i.name === name) && <p className="text-bad text-xs mt-2">An intent with this name already exists.</p>}
        </Modal>
      )}
    </div>
  );
}
