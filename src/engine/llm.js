// Groq LPU Cloud Inference client.
// High-speed, secure LLM client. The API key is stored only in the user's
// browser (localStorage) and never exposed or logged.

export const GROQ_MODELS = [
  { id: 'llama-3.3-70b-versatile', label: 'llama-3.3-70b-versatile (Recommended)' },
  { id: 'llama-3.1-8b-instant', label: 'llama-3.1-8b-instant (Fast)' },
  { id: 'gemma2-9b-it', label: 'gemma2-9b-it' },
  { id: 'mixtral-8x7b-32768', label: 'mixtral-8x7b-32768' },
];

/**
 * Fetch the live list of available chat models for this Groq API key.
 */
export async function fetchGroqModels(apiKey, baseUrl = '/api/groq') {
  if (!apiKey || !apiKey.trim()) return GROQ_MODELS;
  const base = baseUrl.replace(/\/$/, '');
  const r = await fetch(`${base}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
    },
  });

  if (!r.ok) {
    if (r.status === 401) throw new Error('Invalid Groq API key (401 Unauthorized)');
    const txt = await r.text().catch(() => '');
    try {
      const j = JSON.parse(txt);
      if (j.error?.message) throw new Error(j.error.message);
    } catch (e) {
      if (e.message && !e.message.startsWith('Unexpected')) throw e;
    }
    throw new Error(`Groq API error HTTP ${r.status}`);
  }

  const j = await r.json();
  const list = (j.data || [])
    .filter((m) => !m.id.includes('whisper') && !m.id.includes('guard') && !m.id.includes('vision'))
    .map((m) => ({ id: m.id, label: m.id }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return list.length > 0 ? list : GROQ_MODELS;
}

/**
 * Validates a Groq API key by querying the models endpoint.
 * This guarantees verification without failing on hardcoded model IDs.
 */
export async function validateGroqKey(apiKey, baseUrl = '/api/groq') {
  if (!apiKey || !apiKey.trim()) throw new Error('API key cannot be empty');
  const models = await fetchGroqModels(apiKey, baseUrl);
  return { ok: true, models };
}

/**
 * Request a JSON object from Groq matching `schema`.
 * Returns { data, ms, model, raw }.
 */
export async function chatJSON(settings, { system, user, schema, temperature = 0 }) {
  const t0 = performance.now();
  const apiKey = settings.groqApiKey?.trim();
  if (!apiKey) {
    throw new Error('Groq API Key is missing. Please enter your API key in Settings or top bar.');
  }

  const model = settings.groqModel || 'llama-3.3-70b-versatile';
  const base = (settings.groqBaseUrl || '/api/groq').replace(/\/$/, '');

  const messages = [
    {
      role: 'system',
      content: `${system}\n\nIMPORTANT: You must respond ONLY with a single valid JSON object that strictly adheres to the requested JSON schema:\n${JSON.stringify(schema)}`,
    },
    { role: 'user', content: user },
  ];

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let errMsg = `Groq API Error (${res.status})`;
    try {
      const parsed = JSON.parse(body);
      if (parsed.error?.message) errMsg = `Groq: ${parsed.error.message}`;
    } catch {}
    if (res.status === 401) errMsg = 'Invalid Groq API Key. Please verify your key in Settings.';
    throw new Error(errMsg);
  }

  const j = await res.json();
  const raw = j.choices?.[0]?.message?.content ?? '';
  return {
    data: parseJSON(raw),
    raw,
    ms: Math.round(performance.now() - t0),
    model,
  };
}

function parseJSON(raw) {
  try { return JSON.parse(raw); } catch { /* fall through */ }
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error('Groq did not return valid JSON');
}

/** Warm up test */
export async function warmup(settings) {
  if (settings.groqApiKey) {
    await validateGroqKey(settings.groqApiKey, settings.groqBaseUrl);
  }
}
