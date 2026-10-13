// LLM NLU — the core VoxLex enhancement.
// Instead of matching sample utterances, a local LLM reads the bot schema and the
// dialog context and returns intent + ALL slot values it can find in one shot.

import { chatJSON } from './llm.js';
import { BUILTIN_SLOT_TYPES, canonicalize, resolveSlot } from './slotTypes.js';

function describeSlotType(bot, type) {
  if (BUILTIN_SLOT_TYPES[type]) return `${type} (${BUILTIN_SLOT_TYPES[type].description})`;
  const t = bot.slotTypes.find((s) => s.name === type);
  if (!t) return type;
  const vals = t.values.map((v) => v.value + (v.synonyms?.length ? ` [aka ${v.synonyms.join(', ')}]` : '')).join('; ');
  return `${type} — one of: ${vals}${t.resolution === 'expand' ? ' (other similar values allowed)' : ''}`;
}

export function buildPrompt(bot, text, session) {
  const today = new Date();
  const intents = bot.intents.map((i) => {
    const slots = i.slots.map((s) => `    - ${s.name}: ${describeSlotType(bot, s.type)}${s.required ? ' (required)' : ''}`).join('\n');
    const ex = i.utterances.slice(0, 4).map((u) => `"${u}"`).join(', ');
    return `- ${i.name}: ${i.description || ''}\n  examples: ${ex}\n${slots ? `  slots:\n${slots}` : '  slots: none'}`;
  }).join('\n');

  const active = session?.intent;
  const ctx = active
    ? `Conversation context: the user is in the middle of intent "${active.name}". ` +
      `Filled so far: ${JSON.stringify(Object.fromEntries(Object.entries(active.slots).filter(([, v]) => v)))}. ` +
      (session.dialogAction?.type === 'ElicitSlot' ? `The bot just asked the user for slot "${session.dialogAction.slotToElicit}". ` : '') +
      (session.dialogAction?.type === 'ConfirmIntent' ? 'The bot just asked the user to confirm (yes/no). ' : '') +
      'If the user is answering, keep the same intent.'
    : 'Conversation context: start of conversation.';

  const system = `You are the natural-language-understanding engine of a conversational bot called "${bot.name}" (${bot.description || 'no description'}).
Classify the user's message into exactly one intent and extract slot values.
Today is ${today.toDateString()} (${today.toISOString().slice(0, 10)}).

Intents:
${intents}
- FallbackIntent: use when the message matches none of the intents above.

Rules:
- Extract every slot value present in the message, for the chosen intent only. Use null for slots not mentioned. Never invent values.
- Dates as YYYY-MM-DD, times as HH:MM (24h), numbers as digits.
- The message may come from speech recognition and contain homophones: "too"/"to" can mean two, "for" can mean four.
- For slots with a fixed value list, output the closest listed value.
- "confirmation": "Confirmed" if the user agrees (yes, sure, go ahead), "Denied" if they refuse (no, cancel), otherwise "None".
- "confidence": 0.0–1.0, how sure you are about the intent.
${ctx}`;

  const slotNames = [...new Set(bot.intents.flatMap((i) => i.slots.map((s) => s.name)))];
  const schema = {
    type: 'object',
    properties: {
      intent: { type: 'string', enum: [...bot.intents.map((i) => i.name), 'FallbackIntent'] },
      confidence: { type: 'number' },
      slots: {
        type: 'object',
        properties: Object.fromEntries(slotNames.map((n) => [n, { type: ['string', 'null'] }])),
        required: slotNames,
      },
      confirmation: { type: 'string', enum: ['Confirmed', 'Denied', 'None'] },
    },
    required: ['intent', 'confidence', 'slots', 'confirmation'],
  };
  return { system, user: text, schema };
}

const NULLISH = /^\s*(none|null|n\/a|na|unknown|not specified|-)?\s*$/i;

// Anti-hallucination guard: a slot value is only accepted if there's evidence for it in
// the user's message. Dates/times are trusted (the LLM resolves "tonight", "next friday").
function grounded(bot, type, raw, value, text) {
  if (type === 'AMAZON.Date' || type === 'AMAZON.Time') return true;
  const t = text.toLowerCase();
  if (t.includes(raw.toLowerCase()) || t.includes(String(value).toLowerCase())) return true;
  if (type === 'AMAZON.Number') {
    if (value === '1' && /\b(a|an|one|single)\b/.test(t)) return true;
    // Speech recognition often writes numbers as homophones ("too large pizzas", "for people").
    const HOMOPHONES = { too: '2', to: '2', for: '4', won: '1', ate: '8' };
    const nums = t.split(/[^a-z0-9.]+/).map((w) => HOMOPHONES[w] || BUILTIN_SLOT_TYPES['AMAZON.Number'].resolve(w)).filter(Boolean);
    return nums.includes(String(value));
  }
  return resolveSlot(bot, type, text) === value;
}

export async function llmInterpret(bot, text, session, settings) {
  const { system, user, schema } = buildPrompt(bot, text, session);
  const { data, ms, model, raw } = await chatJSON(settings, { system, user, schema });
  const intent = bot.intents.find((i) => i.name === data.intent);
  const slots = {};
  const rejected = {};
  if (intent) {
    for (const s of intent.slots) {
      const raw = data.slots?.[s.name];
      if (raw == null || NULLISH.test(String(raw))) continue;
      const v = canonicalize(bot, s.type, raw);
      if (!v) continue;
      if (session?.intent?.name === intent.name && session.intent.slots[s.name] === v) continue; // already known
      if (grounded(bot, s.type, String(raw), v, text)) slots[s.name] = v;
      else rejected[s.name] = raw;
    }
  }
  return {
    rejected,
    intent: intent ? intent.name : 'FallbackIntent',
    confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
    slots,
    confirmation: data.confirmation || 'None',
    ms,
    model,
    raw,
  };
}
