import { useState } from 'react';
import { GitBranch, Plus, Tag } from 'lucide-react';
import { actions } from '../store.js';
import { Badge, Button, Container, Field, Input, Modal, Select, Table } from '../components/ui.jsx';

const snapshotOf = (bot) => {
  const { versions, aliases, ...rest } = bot;
  return JSON.parse(JSON.stringify(rest));
};

export default function Versions({ bot }) {
  const [desc, setDesc] = useState('');
  const [aliasModal, setAliasModal] = useState(null);

  const createVersion = () => {
    const next = String((bot.versions.length ? Math.max(...bot.versions.map((v) => +v.version)) : 0) + 1);
    actions.updateBot(bot.id, (b) => ({ ...b, versions: [...b.versions, { version: next, description: desc, createdAt: new Date().toISOString(), snapshot: snapshotOf(b) }] }));
    setDesc('');
  };

  const saveAlias = () => {
    const { name, version, original } = aliasModal;
    if (!/^[A-Za-z][\w-]*$/.test(name)) return;
    actions.updateBot(bot.id, (b) => ({
      ...b,
      aliases: original
        ? b.aliases.map((a) => (a.name === original ? { name, version } : a))
        : [...b.aliases.filter((a) => a.name !== name), { name, version }],
    }));
    setAliasModal(null);
  };

  return (
    <div className="space-y-5">
      <Container title="Versions" description="A version is an immutable, numbered snapshot of the bot's Draft. Aliases point at versions so you can ship safely." padded={false}
        actions={<div className="flex gap-2"><Input className="w-56" placeholder="Version description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} /><Button variant="primary" icon={GitBranch} onClick={createVersion}>Create version</Button></div>}>
        <Table
          columns={[
            { key: 'version', label: 'Version', render: (v) => <span className="font-semibold">{v.version === 'DRAFT' ? 'Draft' : `Version ${v.version}`}</span> },
            { key: 'description', label: 'Description', render: (v) => <span className="text-muted">{v.description || '—'}</span> },
            { key: 'intents', label: 'Intents', render: (v) => v.snapshot?.intents.length ?? bot.intents.length },
            { key: 'aliases', label: 'Aliases', render: (v) => <div className="flex gap-1 flex-wrap">{bot.aliases.filter((a) => a.version === v.version).map((a) => <Badge key={a.name} tone="orange"><Tag size={10} />{a.name}</Badge>)}</div> },
            { key: 'createdAt', label: 'Created', render: (v) => <span className="text-muted">{v.createdAt ? new Date(v.createdAt).toLocaleString() : 'Working copy'}</span> },
          ]}
          rows={[{ version: 'DRAFT', id: 'DRAFT' }, ...[...bot.versions].reverse().map((v) => ({ ...v, id: v.version }))]}
        />
      </Container>

      <Container title="Aliases" description="Clients call the bot through an alias (e.g. prod → Version 2). TestBotAlias always points to Draft." padded={false}
        actions={<Button icon={Plus} onClick={() => setAliasModal({ name: '', version: bot.versions.at(-1)?.version || 'DRAFT' })}>Create alias</Button>}>
        <Table
          onRowClick={(a) => a.name !== 'TestBotAlias' && setAliasModal({ ...a, original: a.name })}
          columns={[
            { key: 'name', label: 'Alias name', render: (a) => <span className="font-semibold text-link">{a.name}</span> },
            { key: 'version', label: 'Associated version', render: (a) => (a.version === 'DRAFT' ? 'Draft' : `Version ${a.version}`) },
            { key: 'endpoint', label: 'Runtime endpoint', render: (a) => <code className="text-[11.5px] font-mono text-muted">POST /bots/{bot.id}/botAliases/{a.name}/botLocales/en_US/sessions/:id/text</code> },
          ]}
          rows={bot.aliases.map((a) => ({ ...a, id: a.name }))}
        />
      </Container>

      {aliasModal && (
        <Modal title={aliasModal.original ? `Edit alias ${aliasModal.original}` : 'Create alias'} onClose={() => setAliasModal(null)}
          footer={<>
            {aliasModal.original && <Button variant="danger" onClick={() => { actions.updateBot(bot.id, (b) => ({ ...b, aliases: b.aliases.filter((a) => a.name !== aliasModal.original) })); setAliasModal(null); }}>Delete</Button>}
            <Button variant="link" onClick={() => setAliasModal(null)}>Cancel</Button><Button variant="primary" onClick={saveAlias}>Save</Button>
          </>}>
          <div className="space-y-3">
            <Field label="Alias name"><Input value={aliasModal.name} onChange={(e) => setAliasModal({ ...aliasModal, name: e.target.value })} placeholder="prod" /></Field>
            <Field label="Version">
              <Select value={aliasModal.version} onChange={(e) => setAliasModal({ ...aliasModal, version: e.target.value })}>
                <option value="DRAFT">Draft</option>
                {bot.versions.map((v) => <option key={v.version} value={v.version}>Version {v.version}</option>)}
              </Select>
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
