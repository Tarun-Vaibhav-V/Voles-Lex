// "Classic" NLU — emulates Lex's sample-utterance based matching.
// Intent score = Dice similarity between input tokens and the best sample utterance,
// with {Slot} placeholders matched by regex. Slots are only filled when a template
// lines up with the input, which is exactly why classic bots need many utterances.

import { resolveSlot } from './slotTypes.js';

const STOP = new Set(['a', 'an', 'the', 'please', 'to', 'for', 'of', 'me', 'my', 'i', 'can', 'you', 'would', 'like', 'want', 'could', 'some', 'is', 'it', 'and', 'on', 'at', 'in', 'just']);

const stem = (w) => w.replace(/(ing|ed|es|s)$/, '') || w;
const tokens = (s) => s.toLowerCase().replace(/\{[^}]+\}/g, ' ').replace(/[^a-z0-9\s']/g, ' ')
  .split(/\s+/).filter((w) => w && !STOP.has(w)).map(stem);

function dice(a, b) {
  if (!a.length || !b.length) return 0;
  const B = new Set(b);
  const inter = new Set(a.filter((x) => B.has(x))).size;
  return (2 * inter) / (new Set(a).size + B.size);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function templateRegex(utterance) {
  const names = [];
  const pattern = utterance.trim().split(/(\{[^}]+\})/).map((part) => {
    const m = part.match(/^\{([^}]+)\}$/);
    if (m) { names.push(m[1]); return '(.+?)'; }
    return escapeRe(part.toLowerCase()).replace(/\s+/g, '\\s+');
  }).join('');
  return { re: new RegExp(`^\\s*${pattern}\\s*[.!?]*\\s*$`, 'i'), names };
}

export function classicInterpret(bot, text) {
  const input = tokens(text);
  const results = [];
  for (const intent of bot.intents) {
    let best = { score: 0, slots: {} };
    for (const u of intent.utterances) {
      const { re, names } = templateRegex(u);
      const m = text.trim().match(re);
      if (m) {
        const slots = {};
        names.forEach((n, i) => {
          const slot = intent.slots.find((s) => s.name === n);
          if (slot) {
            const v = resolveSlot(bot, slot.type, m[i + 1], { direct: true });
            if (v) slots[n] = v;
          }
        });
        const score = Object.keys(slots).length === names.length ? 1 : 0.85;
        if (score > best.score) best = { score, slots, matched: u };
        continue;
      }
      const s = dice(input, tokens(u));
      if (s > best.score) best = { score: s, slots: {}, matched: u };
    }
    results.push({ intent: intent.name, confidence: +best.score.toFixed(2), slots: best.slots, matched: best.matched });
  }
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}
