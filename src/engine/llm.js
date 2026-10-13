// Local LLM client. Two runtimes, both fully on-device:
//  - "ollama": talks to an Ollama server on this machine (Gemma 3, Qwen, ...)
//  - "webllm": runs the model inside the browser tab via WebGPU (no server at all)

export const WEBLLM_MODELS = [
  { id: 'gemma-2-2b-it-q4f16_1-MLC', label: 'Gemma 2 2B (≈1.4 GB)' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 1.5B (≈1 GB)' },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B (≈0.9 GB)' },
];

let webllmEngine = null;
let webllmModelLoaded = null;

export async function listOllamaModels(baseUrl) {
  const r = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`);
  if (!r.ok) throw new Error(`Ollama responded ${r.status}`);
  const j = await r.json();
  return j.models.map((m) => ({ name: m.name, size: m.size, family: m.details?.family }));
}

export async function loadWebLLM(model, onProgress) {
  if (webllmEngine && webllmModelLoaded === model) return webllmEngine;
  if (!('gpu' in navigator)) throw new Error('WebGPU is not available in this browser (try Chrome / Edge).');
  const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
  webllmEngine = await CreateMLCEngine(model, {
    initProgressCallback: (p) => onProgress?.(p.text, p.progress),
  });
  webllmModelLoaded = model;
  return webllmEngine;
}

export const webllmStatus = () => webllmModelLoaded;

/**
 * Ask the local model for a JSON object that matches `schema`.
 * Returns { data, ms, model, raw }.
 */
export async function chatJSON(settings, { system, user, schema, temperature = 0 }) {
  const t0 = performance.now();
  if (settings.provider === 'webllm') {
    const engine = await loadWebLLM(settings.webllmModel, settings.onProgress);
    const res = await engine.chat.completions.create({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature,
      response_format: { type: 'json_object', schema: JSON.stringify(schema) },
    });
    const raw = res.choices[0].message.content;
    return { data: parseJSON(raw), raw, ms: Math.round(performance.now() - t0), model: settings.webllmModel };
  }

  const r = await fetch(`${settings.ollamaUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.model,
      stream: false,
      ...(settings._noThink ? {} : { think: false }),
      keep_alive: '30m',
      format: schema,
      options: { temperature, num_ctx: 4096 },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    // Some models reject `think`; retry without it.
    if (r.status === 400 && /think/i.test(body) && !settings._noThink) {
      return chatJSON({ ...settings, _noThink: true }, { system, user, schema, temperature });
    }
    throw new Error(`Ollama error ${r.status}: ${body.slice(0, 200)}`);
  }
  const j = await r.json();
  const raw = j.message?.content ?? '';
  return { data: parseJSON(raw), raw, ms: Math.round(performance.now() - t0), model: settings.model };
}

function parseJSON(raw) {
  try { return JSON.parse(raw); } catch { /* fall through */ }
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error('Model did not return JSON');
}

/** Warm the model so the first real turn is fast. */
export async function warmup(settings) {
  if (settings.provider === 'webllm') return loadWebLLM(settings.webllmModel, settings.onProgress);
  await fetch(`${settings.ollamaUrl.replace(/\/$/, '')}/api/generate`, {
    method: 'POST',
    body: JSON.stringify({ model: settings.model, prompt: '', keep_alive: '30m' }),
  });
}
