// Built-in slot types (mirrors Amazon Lex AMAZON.* types) + custom slot type resolution.

const NUMBER_WORDS = {
  zero: 0, one: 1, a: 1, an: 1, single: 1, two: 2, couple: 2, pair: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100,
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'];

const CITIES = ['new york', 'los angeles', 'chicago', 'seattle', 'san francisco', 'boston', 'miami',
  'london', 'paris', 'berlin', 'tokyo', 'singapore', 'dubai', 'sydney', 'toronto',
  'mumbai', 'delhi', 'new delhi', 'bangalore', 'bengaluru', 'chennai', 'hyderabad', 'kolkata', 'pune',
  'vellore', 'kochi', 'goa', 'jaipur', 'ahmedabad', 'coimbatore', 'mysore'];

const iso = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const BUILTIN_SLOT_TYPES = {
  'AMAZON.Number': {
    description: 'Numbers in digits or words (e.g. 3, "three", "a dozen")',
    resolve(text) {
      const m = text.match(/-?\d+(\.\d+)?/);
      if (m) return m[0];
      const words = text.toLowerCase().split(/[\s-]+/);
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w in NUMBER_WORDS && !(w === 'a' || w === 'an')) {
          let v = NUMBER_WORDS[w];
          if (v >= 20 && v < 100 && NUMBER_WORDS[words[i + 1]] < 10) v += NUMBER_WORDS[words[i + 1]];
          return String(v);
        }
      }
      return null;
    },
  },
  'AMAZON.Date': {
    description: 'Dates like "today", "tomorrow", "next friday", "march 3", "2026-10-12"',
    resolve(text, now = new Date()) {
      const t = text.toLowerCase();
      const isoM = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
      if (isoM) return isoM[0];
      const d = new Date(now);
      if (/\btoday\b|\btonight\b/.test(t)) return iso(d);
      if (/\bday after tomorrow\b/.test(t)) { d.setDate(d.getDate() + 2); return iso(d); }
      if (/\btomorrow\b/.test(t)) { d.setDate(d.getDate() + 1); return iso(d); }
      const inDays = t.match(/\bin (\d+|a|one|two|three|four|five|six|seven) (day|days|week|weeks)\b/);
      if (inDays) {
        const n = /\d/.test(inDays[1]) ? +inDays[1] : NUMBER_WORDS[inDays[1]];
        d.setDate(d.getDate() + n * (inDays[2].startsWith('week') ? 7 : 1));
        return iso(d);
      }
      for (let i = 0; i < 7; i++) {
        if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(t)) {
          const diff = (i - d.getDay() + 7) % 7 || 7;
          d.setDate(d.getDate() + diff);
          return iso(d);
        }
      }
      for (let i = 0; i < 12; i++) {
        const re = new RegExp(`\\b(\\d{1,2})(st|nd|rd|th)? (of )?${MONTHS[i]}\\b|\\b${MONTHS[i]} (\\d{1,2})(st|nd|rd|th)?\\b`);
        const m = t.match(re);
        if (m) {
          const day = +(m[1] || m[4]);
          let year = d.getFullYear();
          const cand = new Date(year, i, day);
          if (cand < new Date(d.getFullYear(), d.getMonth(), d.getDate())) year++;
          return iso(new Date(year, i, day));
        }
      }
      const slash = t.match(/\b(\d{1,2})\/(\d{1,2})(\/(\d{2,4}))?\b/);
      if (slash) {
        const year = slash[4] ? (slash[4].length === 2 ? 2000 + +slash[4] : +slash[4]) : d.getFullYear();
        return iso(new Date(year, +slash[2] - 1, +slash[1]));
      }
      return null;
    },
  },
  'AMAZON.Time': {
    description: 'Times like "8 pm", "19:30", "noon", "evening"',
    resolve(text) {
      const t = text.toLowerCase();
      if (/\bnoon\b/.test(t)) return '12:00';
      if (/\bmidnight\b/.test(t)) return '00:00';
      const m = t.match(/\b(\d{1,2})(:(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|o'?clock)?\b/);
      if (m && (m[2] || m[4] || /\bat\b/.test(t))) {
        let h = +m[1];
        const min = m[3] || '00';
        if (h > 23) return null;
        const mer = m[4] || '';
        if (mer.startsWith('p') && h < 12) h += 12;
        if (mer.startsWith('a') && h === 12) h = 0;
        if (!mer && /\b(evening|night|tonight|pm)\b/.test(t) && h < 12) h += 12;
        return `${String(h).padStart(2, '0')}:${min}`;
      }
      if (/\bmorning\b/.test(t)) return 'MO';
      if (/\bafternoon\b/.test(t)) return 'AF';
      if (/\bevening\b/.test(t)) return 'EV';
      return null;
    },
  },
  'AMAZON.City': {
    description: 'City names (a built-in catalog of major world & Indian cities)',
    resolve(text) {
      const t = text.toLowerCase();
      const hit = [...CITIES].sort((a, b) => b.length - a.length).find((c) => new RegExp(`\\b${c}\\b`).test(t));
      return hit ? hit.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
    },
  },
  'AMAZON.PhoneNumber': {
    description: 'Phone numbers (7–13 digits, spaces/dashes allowed)',
    resolve(text) {
      const m = text.match(/\+?\d[\d\s-]{6,15}\d/);
      return m ? m[0].replace(/[\s-]/g, '') : null;
    },
  },
  'AMAZON.EmailAddress': {
    description: 'Email addresses',
    resolve(text) {
      const m = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      return m ? m[0] : null;
    },
  },
  'AMAZON.FirstName': {
    description: 'A first name (captured from "my name is X", "I am X", or a single word answer)',
    resolve(text, _now, { direct } = {}) {
      const m = text.match(/\b(?:name is|i am|i'm|this is|call me)\s+([a-z][a-z'-]+)/i);
      if (m) return cap(m[1]);
      if (direct) {
        const w = text.trim().split(/\s+/);
        if (w.length <= 2) return cap(w[0].replace(/[^a-z'-]/gi, ''));
      }
      return null;
    },
  },
  'AMAZON.AlphaNumeric': {
    description: 'Any word/ID token, e.g. booking references like "AB123"',
    resolve(text, _now, { direct } = {}) {
      const m = text.match(/\b(?=[A-Za-z]*\d)[A-Za-z0-9]{3,}\b/);
      if (m) return m[0].toUpperCase();
      return direct ? text.trim() : null;
    },
  },
  'AMAZON.FreeFormInput': {
    description: 'Captures the whole user input verbatim',
    resolve(text, _now, { direct } = {}) {
      return direct ? text.trim() : null;
    },
  },
};

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Levenshtein distance for light fuzzy matching on custom slot values.
function lev(a, b) {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Resolve a value from text for a custom slot type. Returns canonical value or null. */
export function resolveCustom(slotType, text, { direct = false } = {}) {
  const t = ` ${norm(text)} `;
  const candidates = [];
  for (const v of slotType.values) {
    for (const phrase of [v.value, ...(v.synonyms || [])]) {
      const p = norm(phrase);
      if (p && t.includes(` ${p} `)) candidates.push({ value: v.value, len: p.length });
    }
  }
  if (candidates.length) return candidates.sort((a, b) => b.len - a.len)[0].value;

  // Fuzzy: tolerate typos / ASR errors on single tokens
  const tokens = norm(text).split(' ');
  let best = null;
  for (const v of slotType.values) {
    for (const phrase of [v.value, ...(v.synonyms || [])]) {
      const p = norm(phrase);
      if (!p || p.includes(' ') || p.length < 4) continue;
      for (const tok of tokens) {
        const d = lev(tok, p);
        if (d <= 1 && (!best || d < best.d)) best = { value: v.value, d };
      }
    }
  }
  if (best) return best.value;

  // "Expand values" strategy: accept the raw answer when directly elicited
  if (direct && slotType.resolution === 'expand' && text.trim().split(/\s+/).length <= 4) return text.trim();
  return null;
}

/** Resolve a slot value given the bot (for custom types). */
export function resolveSlot(bot, slotTypeName, text, opts = {}) {
  const builtin = BUILTIN_SLOT_TYPES[slotTypeName];
  if (builtin) return builtin.resolve(text, new Date(), opts);
  const custom = bot.slotTypes.find((s) => s.name === slotTypeName);
  if (!custom) return null;
  return resolveCustom(custom, text, opts);
}

/** Normalise an LLM-extracted value onto the slot type's canonical value set. */
export function canonicalize(bot, slotTypeName, value) {
  if (value == null || value === '') return null;
  const s = String(value);
  if (BUILTIN_SLOT_TYPES[slotTypeName]) {
    return BUILTIN_SLOT_TYPES[slotTypeName].resolve(s, new Date(), { direct: true }) ?? s;
  }
  const custom = bot.slotTypes.find((t) => t.name === slotTypeName);
  if (!custom) return s;
  return resolveCustom(custom, s, { direct: true }) ?? (custom.resolution === 'expand' ? s : null);
}
