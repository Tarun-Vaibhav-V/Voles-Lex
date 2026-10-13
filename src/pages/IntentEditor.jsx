import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { actions, useStore } from '../store.js';
import { go } from '../router.js';
import { BUILTIN_SLOT_TYPES } from '../engine/slotTypes.js';
import { chatJSON } from '../engine/llm.js';
import { Alert, Badge, Button, Container, Field, Input, Select, Textarea, Toggle } from '../components/ui.jsx';

export default function IntentEditor({ bot, intentId }) {
  const intent = bot.intents.find((i) => i.id === intentId);
  const settings = useStore((s) => s.settings);
  const [draft, setDraft] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [err, setErr] = useState('');
  if (!intent) return <Alert tone="error">Intent not found. <button className="text-link" onClick={() => go(`bots/${bot.id}/intents`)}>Back to intents</button></Alert>;

  const update = (patch) => actions.updateBot(bot.id, (b) => ({ ...b, intents: b.intents.map((i) => (i.id === intentId ? { ...i, ...(typeof patch === 'function' ? patch(i) : patch) } : i)) }));
  const setSlot = (idx, patch) => update((i) => ({ slots: i.slots.map((s, n) => (n === idx ? { ...s, ...patch } : s)) }));
  const moveSlot = (idx, d) => update((i) => { const s = [...i.slots]; const [x] = s.splice(idx, 1); s.splice(idx + d, 0, x); return { slots: s }; });

  const addUtterance = () => {
    const u = draft.trim();
    if (!u || intent.utterances.includes(u)) return;
    update((i) => ({ utterances: [...i.utterances, u] }));
    setDraft('');
  };

  const slotTypeOptions = [...bot.slotTypes.map((t) => t.name), ...Object.keys(BUILTIN_SLOT_TYPES)];
  const badRefs = intent.utterances.flatMap((u) => [...u.matchAll(/\{(\w+)\}/g)].map((m) => m[1])).filter((n) => !intent.slots.some((s) => s.name === n));

  async function suggestUtterances() {
    setSuggesting(true); setErr('');
    try {
      const { data } = await chatJSON(settings, {
        system: `Write 8 new, varied, natural sample utterances a user might say for the chatbot intent "${intent.name}" (${intent.description || ''}). ` +
          `Use slot placeholders in curly braces where a value would appear. Available slots: ${intent.slots.map((s) => `{${s.name}}`).join(', ') || 'none'}. ` +
          `Mix short and long phrasings, casual and formal. Do not repeat existing ones: ${JSON.stringify(intent.utterances)}`,
        user: 'Generate the utterances.',
        schema: { type: 'object', properties: { utterances: { type: 'array', items: { type: 'string' } } }, required: ['utterances'] },
        temperature: 0.7,
      });
      const names = new Set(intent.slots.map((s) => s.name));
      const fresh = (data.utterances || []).map((u) => u.trim()).filter((u) => u && !intent.utterances.includes(u) && [...u.matchAll(/\{(\w+)\}/g)].every((m) => names.has(m[1])));
      update((i) => ({ utterances: [...i.utterances, ...fresh] }));
    } catch (e) { setErr(e.message); } finally { setSuggesting(false); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{intent.name}</h1>
        <Button onClick={() => go(`bots/${bot.id}/intents`)}>Back to intents</Button>
      </div>

      <Container title="Intent details">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Intent name"><Input value={intent.name} onChange={(e) => update({ name: e.target.value.replace(/\W/g, '') })} /></Field>
          <Field label="Description" hint="Also used by the LLM to understand when this intent applies."><Input value={intent.description} onChange={(e) => update({ description: e.target.value })} /></Field>
        </div>
      </Container>

      <Container
        title={`Sample utterances (${intent.utterances.length})`}
        description="Phrases users might say to trigger this intent. Reference slots with {SlotName}."
        actions={<Button icon={Sparkles} disabled={suggesting} onClick={suggestUtterances}>{suggesting ? 'Thinking…' : 'Suggest with AI'}</Button>}
      >
        <div className="flex gap-2 mb-3">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addUtterance()} placeholder="I want to book a flight to {City}" />
          <Button onClick={addUtterance} icon={Plus}>Add</Button>
        </div>
        {err && <Alert tone="error" className="mb-3">{err}</Alert>}
        {badRefs.length > 0 && <Alert tone="warn" className="mb-3">Utterances reference undefined slot(s): {[...new Set(badRefs)].map((b) => `{${b}}`).join(', ')}</Alert>}
        <ul className="divide-y divide-line/70 border border-line/70 rounded-lg">
          {intent.utterances.length === 0 && <li className="text-muted text-sm p-3">No utterances yet.</li>}
          {intent.utterances.map((u, n) => (
            <li key={n} className="flex items-center gap-2 px-3 py-2 group">
              <span className="flex-1 text-sm">{u.split(/(\{\w+\})/).map((p, k) => (/^\{\w+\}$/.test(p) ? <span key={k} className="px-1 rounded bg-blue-100 text-link font-mono text-[12.5px]">{p}</span> : p))}</span>
              <button className="text-muted hover:text-bad opacity-0 group-hover:opacity-100" onClick={() => update((i) => ({ utterances: i.utterances.filter((_, k) => k !== n) }))}><X size={15} /></button>
            </li>
          ))}
        </ul>
      </Container>

      <Container
        title={`Slots (${intent.slots.length})`}
        description="Information the bot needs to fulfil the intent. Elicited in priority order."
        actions={<Button icon={Plus} onClick={() => update((i) => ({ slots: [...i.slots, { name: `Slot${i.slots.length + 1}`, type: slotTypeOptions[0], prompt: 'What is the value?', required: true, retryPrompt: '' }] }))}>Add slot</Button>}
      >
        {intent.slots.length === 0 && <p className="text-muted text-sm">This intent has no slots.</p>}
        <div className="space-y-3">
          {intent.slots.map((s, n) => (
            <div key={n} className="border border-line rounded-lg p-3.5">
              <div className="flex items-center gap-2 mb-3">
                <Badge tone="gray">Priority {n + 1}</Badge>
                <div className="flex-1" />
                <Toggle checked={s.required} onChange={(v) => setSlot(n, { required: v })} label={s.required ? 'Required' : 'Optional'} />
                <button disabled={n === 0} className="text-muted disabled:opacity-30" onClick={() => moveSlot(n, -1)}><ArrowUp size={15} /></button>
                <button disabled={n === intent.slots.length - 1} className="text-muted disabled:opacity-30" onClick={() => moveSlot(n, 1)}><ArrowDown size={15} /></button>
                <button className="text-muted hover:text-bad" onClick={() => update((i) => ({ slots: i.slots.filter((_, k) => k !== n) }))}><Trash2 size={15} /></button>
              </div>
              <div className="grid md:grid-cols-[1fr_1fr_2fr] gap-3">
                <Field label="Name"><Input value={s.name} onChange={(e) => setSlot(n, { name: e.target.value.replace(/\W/g, '') })} /></Field>
                <Field label="Slot type">
                  <Select value={s.type} onChange={(e) => setSlot(n, { type: e.target.value })}>
                    {bot.slotTypes.length > 0 && <optgroup label="Custom">{bot.slotTypes.map((t) => <option key={t.name}>{t.name}</option>)}</optgroup>}
                    <optgroup label="Built-in">{Object.keys(BUILTIN_SLOT_TYPES).map((t) => <option key={t}>{t}</option>)}</optgroup>
                  </Select>
                </Field>
                <Field label="Prompt"><Input value={s.prompt} onChange={(e) => setSlot(n, { prompt: e.target.value })} /></Field>
              </div>
            </div>
          ))}
        </div>
      </Container>

      <Container title="Confirmation" description="Ask the user to confirm before fulfilling. Use {SlotName} to insert values. Leave empty to skip.">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Confirmation prompt"><Textarea rows={2} value={intent.confirmationPrompt} onChange={(e) => update({ confirmationPrompt: e.target.value })} /></Field>
          <Field label="Decline response"><Textarea rows={2} value={intent.declinationResponse} onChange={(e) => update({ declinationResponse: e.target.value })} /></Field>
        </div>
      </Container>

      <Container title="Fulfillment & closing" description="What happens once all slots are filled and confirmed.">
        <div className="space-y-4">
          <Toggle checked={intent.fulfillmentEnabled} onChange={(v) => update({ fulfillmentEnabled: v })} label={<span>Invoke the <button className="text-link hover:underline" onClick={(e) => { e.stopPropagation(); go(`bots/${bot.id}/fulfillment`); }}>fulfillment Lambda</button> code hook</span>} />
          <Field label="Closing response" hint={intent.fulfillmentEnabled ? 'Used if the Lambda returns no message.' : 'Spoken when the intent is fulfilled.'}>
            <Textarea rows={2} value={intent.closingResponse} onChange={(e) => update({ closingResponse: e.target.value })} />
          </Field>
        </div>
      </Container>
    </div>
  );
}
