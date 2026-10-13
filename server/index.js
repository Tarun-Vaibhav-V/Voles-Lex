// VoxLex local runtime server — exposes bots over a REST API shaped like the
// Amazon Lex V2 runtime (RecognizeText / GetSession / DeleteSession).
// It reuses exactly the same dialog engine as the web console.
//
//   npm run server           → http://localhost:8787
//
// The web console PUTs the bot definitions here automatically (when served from localhost),
// or you can drop VoxLex JSON exports into server/bots/.
import http from 'node:http';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newSession, recognizeText } from '../src/engine/dialog.js';

const PORT = +process.env.PORT || 8787;
const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.VOXLEX_MODEL || 'gemma3:4b';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bots');

const bots = new Map();
const sessions = new Map();

if (fs.existsSync(dir)) {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const b = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    bots.set(b.id, b);
    console.log(`loaded bot ${b.name} (${b.id}) from ${f}`);
  }
}

// Mock Lambda for Node: run the code hook in a vm context with a timeout.
async function runCodeHook(code, event, timeout = 3000) {
  const logs = [];
  const fmt = (a) => a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  const module = { exports: {} };
  const ctx = vm.createContext({ module, exports: module.exports, console: { log: (...a) => logs.push(fmt(a)), error: (...a) => logs.push('ERROR ' + fmt(a)) } });
  vm.runInContext(`${code}\n;globalThis.__h = module.exports.handler || exports.handler || (typeof handler !== 'undefined' ? handler : null);`, ctx, { timeout });
  if (typeof ctx.__h !== 'function') throw new Error('No handler exported');
  const result = await Promise.race([ctx.__h(event, {}), new Promise((_, r) => setTimeout(() => r(new Error('Task timed out')), timeout))]);
  return { result, logs };
}

function resolveAlias(bot, aliasName) {
  const alias = bot.aliases.find((a) => a.name === aliasName);
  if (!alias) return null;
  if (alias.version === 'DRAFT') return { def: bot, version: 'DRAFT' };
  const v = bot.versions.find((x) => x.version === alias.version);
  return v && { def: v.snapshot, version: v.version };
}

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' });
  res.end(JSON.stringify(body, null, 2));
};
const readBody = (req) => new Promise((ok, bad) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 5e6) req.destroy(); });
  req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { bad(e); } });
});

const SESSION_RE = /^\/bots\/([^/]+)\/botAliases\/([^/]+)\/botLocales\/([^/]+)\/sessions\/([^/]+)(\/text)?$/;

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/' || url.pathname === '/health') {
      return send(res, 200, { service: 'VoxLex runtime', bots: [...bots.values()].map((b) => ({ id: b.id, name: b.name, aliases: b.aliases })), model: MODEL });
    }
    if (url.pathname === '/admin/bots' && req.method === 'PUT') {
      const b = await readBody(req);
      bots.set(b.id, b);
      return send(res, 200, { ok: true, id: b.id });
    }
    const m = url.pathname.match(SESSION_RE);
    if (m) {
      const [, botId, aliasName, localeId, sessionId, isText] = m;
      const bot = bots.get(botId) || [...bots.values()].find((b) => b.name === botId);
      if (!bot) return send(res, 404, { __type: 'ResourceNotFoundException', message: `Bot ${botId} not found` });
      const target = resolveAlias(bot, aliasName);
      if (!target) return send(res, 404, { __type: 'ResourceNotFoundException', message: `Alias ${aliasName} not found` });
      const key = `${bot.id}:${aliasName}:${sessionId}`;

      if (req.method === 'DELETE') { sessions.delete(key); return send(res, 200, { botId, botAliasId: aliasName, localeId, sessionId }); }
      if (req.method === 'GET') {
        const s = sessions.get(key);
        return s ? send(res, 200, { sessionId, sessionState: { dialogAction: s.dialogAction, intent: s.intent, sessionAttributes: s.sessionAttributes } }) : send(res, 404, { __type: 'ResourceNotFoundException', message: 'Session not found' });
      }
      if (req.method === 'POST' && isText) {
        const body = await readBody(req);
        if (!body.text) return send(res, 400, { __type: 'ValidationException', message: 'text is required' });
        const session = sessions.get(key) || newSession(sessionId);
        if (body.sessionState?.sessionAttributes) session.sessionAttributes = { ...session.sessionAttributes, ...body.sessionState.sessionAttributes };
        sessions.set(key, session);
        const out = await recognizeText(target.def, session, body.text, {
          nluMode: body.nlu === 'classic' ? 'classic' : 'llm',
          llmSettings: { provider: 'ollama', ollamaUrl: OLLAMA, model: body.model || MODEL },
          runCodeHook, aliasName, version: target.version,
        });
        console.log(`[${bot.name}/${aliasName}] "${body.text}" → ${out.sessionState.intent?.name} ${out.sessionState.dialogAction.type} (${out._voxlex.totalMs} ms)`);
        return send(res, 200, out);
      }
    }
    send(res, 404, { __type: 'UnknownOperationException', message: `${req.method} ${url.pathname}` });
  } catch (e) {
    send(res, 500, { __type: 'InternalFailureException', message: e.message });
  }
}).listen(PORT, () => console.log(`VoxLex runtime listening on http://localhost:${PORT} (LLM: ${MODEL} @ ${OLLAMA})`));
