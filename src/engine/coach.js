// Enhancement: Missed-utterance coach. Looks at turns that fell back / failed and asks the
// local LLM which intent each one was probably meant for, proposing new sample utterances.
import { chatJSON } from './llm.js';

export async function coachSuggestions(settings, bot, missed) {
  const list = [...new Set(missed.map((m) => m.text.trim()))].slice(0, 25);
  if (!list.length) return [];
  const schema = {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            utterance: { type: 'string' },
            intent: { type: 'string', enum: [...bot.intents.map((i) => i.name), 'NewIntent', 'Ignore'] },
            newIntentName: { type: 'string' },
            templated: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['utterance', 'intent', 'templated', 'reason'],
        },
      },
    },
    required: ['suggestions'],
  };
  const intents = bot.intents.map((i) => `- ${i.name}: ${i.description || ''} | slots: ${i.slots.map((s) => `{${s.name}}`).join(' ') || 'none'} | e.g. "${i.utterances[0] || ''}"`).join('\n');
  const system = `You improve a chatbot's training data. For each user message the bot failed to understand, decide which existing intent it belongs to.
Intents:
${intents}
For each message output: the original utterance; the intent ("NewIntent" if it needs a new intent — then give newIntentName in PascalCase; "Ignore" for gibberish/small talk);
"templated": the utterance rewritten as a sample utterance with concrete slot values replaced by {SlotName} placeholders of that intent;
"reason": max 12 words.`;
  const { data } = await chatJSON(settings, { system, user: list.map((t, i) => `${i + 1}. ${t}`).join('\n'), schema });
  // Small models sometimes paraphrase the input — pin each suggestion back to the real utterance.
  return (data.suggestions || []).slice(0, list.length).map((s, k) => {
    const real = list.includes(s.utterance) ? s.utterance : list[k];
    const templated = s.templated && s.templated.length < real.length * 1.6 ? s.templated : real;
    return { ...s, utterance: real, templated };
  });
}

/** Simple local analytics over logged turns. */
export function analytics(logs) {
  const turns = logs.length;
  const missed = logs.filter((l) => l.missed).length;
  const byIntent = {};
  const byNlu = { classic: { n: 0, ms: 0, missed: 0 }, llm: { n: 0, ms: 0, missed: 0 } };
  for (const l of logs) {
    if (l.intent) byIntent[l.intent] = (byIntent[l.intent] || 0) + 1;
    const b = byNlu[l.nlu] || (byNlu[l.nlu] = { n: 0, ms: 0, missed: 0 });
    b.n++; b.ms += l.ms || 0; if (l.missed) b.missed++;
  }
  const fulfilled = logs.filter((l) => l.state === 'Fulfilled').length;
  return { turns, missed, fulfilled, byIntent, byNlu, missRate: turns ? missed / turns : 0 };
}
