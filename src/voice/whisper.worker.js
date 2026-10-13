// On-device speech-to-text (the "Amazon Transcribe" part), running Whisper via
// transformers.js inside a worker. Model weights are cached by the browser after first load.
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

const DTYPE = 'q8'; // q8 weights on WASM: 41 MB (tiny.en) / 77 MB (base.en) instead of 150–290 MB fp32
const BIG_FILES = ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
const CHUNK = 2 * 1024 * 1024;
const PARTS = 'voxlex-partial-downloads';

const fileUrl = (model, file) => `${env.remoteHost}${model}/resolve/main/${file}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url, init, tries = 8) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, init);
      if (r.ok || r.status === 206) return r;
      if (r.status === 404 || r.status === 416) throw Object.assign(new Error(`HTTP ${r.status} for ${url}`), { fatal: true });
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (e.fatal || i >= tries - 1) throw e;
      await sleep(Math.min(8000, 500 * 2 ** i)); // back off on flaky connections
    }
  }
}

async function remoteSize(url) {
  const r = await fetchRetry(url, { headers: { Range: 'bytes=0-0' } });
  const cr = r.headers.get('content-range');
  await r.body?.cancel().catch(() => {});
  const m = cr && cr.match(/\/(\d+)$/);
  if (m) return +m[1];
  return +r.headers.get('content-length');
}

/**
 * Download the large model files in small Range chunks, retrying each chunk and keeping
 * finished chunks in Cache Storage — a dropped connection (or even a page reload) resumes
 * instead of restarting. The assembled file is stored under the exact key transformers.js
 * uses, so the pipeline then loads it straight from cache.
 */
async function prefetch(model, onProgress) {
  const cache = await caches.open(env.cacheKey);
  const parts = await caches.open(PARTS);
  const files = [];
  for (const f of BIG_FILES) {
    const url = fileUrl(model, f);
    if (await cache.match(url)) { files.push({ url, done: true }); continue; }
    files.push({ url, size: await remoteSize(url) });
  }
  const total = files.reduce((n, f) => n + (f.size || 0), 0);
  let loaded = 0;
  for (const f of files) {
    if (f.done) continue;
    const chunks = [];
    for (let start = 0; start < f.size; start += CHUNK) {
      const end = Math.min(start + CHUNK, f.size) - 1;
      const key = `${f.url}?part=${start}-${end}`;
      let blob = await (await parts.match(key))?.blob();
      if (!blob || blob.size !== end - start + 1) {
        const r = await fetchRetry(f.url, { headers: { Range: `bytes=${start}-${end}` } });
        blob = await r.blob();
        if (r.status === 200) blob = blob.slice(start, end + 1); // server ignored Range
        await parts.put(key, new Response(blob));
      }
      chunks.push(blob);
      loaded += blob.size;
      onProgress({ loaded, total, progress: total ? (loaded / total) * 100 : 0 });
    }
    const whole = new Blob(chunks);
    await cache.put(f.url, new Response(whole, { headers: { 'content-length': String(whole.size), 'content-type': 'application/octet-stream' } }));
    for (let start = 0; start < f.size; start += CHUNK) await parts.delete(`${f.url}?part=${start}-${Math.min(start + CHUNK, f.size) - 1}`);
  }
}

// One shared load per model — "preload" and "transcribe" must not start two downloads.
const loads = new Map();

function load(model) {
  if (loads.has(model)) return loads.get(model);
  const t0 = performance.now();
  const report = (p) => self.postMessage({ type: 'progress', model, ...p });
  const promise = (async () => {
    await prefetch(model, report);
    // Small config/tokenizer files are fetched by transformers.js itself (retry the whole load a few times).
    for (let i = 0; ; i++) {
      try {
        return await pipeline('automatic-speech-recognition', model, { device: 'wasm', dtype: DTYPE });
      } catch (e) {
        if (i >= 3) throw e;
        await sleep(1000 * (i + 1));
      }
    }
  })()
    .then(async (asr) => {
      await asr(new Float32Array(8000)).catch(() => {}); // warm-up: first real transcription is ~3x faster
      self.postMessage({ type: 'ready', model, device: 'wasm', ms: Math.round(performance.now() - t0) });
      return asr;
    })
    .catch((err) => {
      loads.delete(model); // allow a retry — finished chunks are kept
      self.postMessage({ type: 'load-error', model, error: String(err?.message || err) });
      throw err;
    });
  loads.set(model, promise);
  return promise;
}

self.onmessage = async (e) => {
  const { type, audio, model, id } = e.data;
  try {
    if (type === 'load') { await load(model); return; }
    if (type === 'transcribe') {
      const asr = await load(model);
      const t0 = performance.now();
      const out = await asr(audio);
      self.postMessage({ type: 'result', id, text: (out.text || '').trim(), ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    if (type === 'transcribe') self.postMessage({ type: 'error', id, error: String(err?.message || err) });
  }
};
