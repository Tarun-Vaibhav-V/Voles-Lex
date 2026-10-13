// Mock AWS Lambda: runs the bot's fulfillment code hook inside an isolated Web Worker
// with a timeout and captured console output (like CloudWatch logs).

const WORKER_SRC = `
self.onmessage = async (e) => {
  const { code, event, timeout } = e.data;
  const logs = [];
  const fmt = (a) => a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
  const console = { log: (...a) => logs.push(fmt(a)), info: (...a) => logs.push(fmt(a)), warn: (...a) => logs.push('WARN ' + fmt(a)), error: (...a) => logs.push('ERROR ' + fmt(a)) };
  try {
    const module = { exports: {} };
    const exports = module.exports;
    const fn = new Function('module', 'exports', 'console', code + '\\n;return (module.exports.handler || exports.handler || (typeof handler !== "undefined" ? handler : null));');
    const handler = fn(module, exports, console);
    if (typeof handler !== 'function') throw new Error('No handler exported. Define exports.handler = async (event) => {...}');
    const result = await handler(event, { functionName: 'VoxLexFulfillment', getRemainingTimeInMillis: () => timeout });
    self.postMessage({ ok: true, result, logs });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.message || err), logs });
  }
};`;

let workerUrl = null;

export function runCodeHook(code, event, timeout = 3000) {
  workerUrl ||= URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
  return new Promise((resolve, reject) => {
    const w = new Worker(workerUrl);
    const timer = setTimeout(() => { w.terminate(); reject(new Error(`Task timed out after ${timeout / 1000} seconds`)); }, timeout);
    w.onmessage = (e) => {
      clearTimeout(timer);
      w.terminate();
      if (e.data.ok) resolve({ result: e.data.result, logs: e.data.logs });
      else { const err = new Error(e.data.error); err.logs = e.data.logs; reject(err); }
    };
    w.onerror = (e) => { clearTimeout(timer); w.terminate(); reject(new Error(e.message)); };
    w.postMessage({ code, event, timeout });
  });
}
