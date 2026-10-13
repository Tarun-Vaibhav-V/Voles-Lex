import { useState } from 'react';
import { Play, RotateCcw, Save } from 'lucide-react';
import { actions } from '../store.js';
import { runCodeHook } from '../engine/lambda.js';
import { DEFAULT_CODE_HOOK } from '../engine/templates.js';
import { Alert, Badge, Button, Code, Container, Field, Select } from '../components/ui.jsx';

function sampleEvent(bot, intentName) {
  const intent = bot.intents.find((i) => i.name === intentName) || bot.intents[0];
  const ex = { 'AMAZON.Number': '2', 'AMAZON.Date': new Date().toISOString().slice(0, 10), 'AMAZON.Time': '20:00', 'AMAZON.City': 'Chennai', 'AMAZON.AlphaNumeric': 'PZ4821' };
  const slots = Object.fromEntries((intent?.slots || []).map((s) => {
    const v = ex[s.type] || bot.slotTypes.find((t) => t.name === s.type)?.values[0]?.value || 'sample';
    return [s.name, { value: { originalValue: v, interpretedValue: v, resolvedValues: [v] } }];
  }));
  return {
    messageVersion: '1.0', invocationSource: 'FulfillmentCodeHook', inputMode: 'Text', inputTranscript: 'test',
    sessionId: 'test-session', bot: { name: bot.name, aliasName: 'TestBotAlias', version: 'DRAFT', localeId: 'en_US' },
    sessionState: { intent: { name: intent?.name, slots, state: 'ReadyForFulfillment', confirmationState: 'Confirmed' }, sessionAttributes: {} },
  };
}

export default function Fulfillment({ bot }) {
  const [code, setCode] = useState(bot.codeHook);
  const [intentName, setIntentName] = useState(bot.intents.find((i) => i.fulfillmentEnabled)?.name || bot.intents[0]?.name);
  const [result, setResult] = useState(null);
  const dirty = code !== bot.codeHook;

  const test = async () => {
    const t0 = performance.now();
    try {
      const r = await runCodeHook(code, sampleEvent(bot, intentName));
      setResult({ ok: true, ms: Math.round(performance.now() - t0), ...r });
    } catch (e) {
      setResult({ ok: false, ms: Math.round(performance.now() - t0), error: e.message, logs: e.logs || [] });
    }
  };

  return (
    <div className="space-y-5">
      <Container
        title="Fulfillment code hook"
        description="Simulates an AWS Lambda function. It receives the Lex V2 event when an intent is ready for fulfillment and returns the response. Runs sandboxed in a Web Worker with a 3 s timeout."
        actions={<>
          <Button variant="ghost" icon={RotateCcw} onClick={() => setCode(DEFAULT_CODE_HOOK)}>Reset</Button>
          <Button variant="primary" icon={Save} disabled={!dirty} onClick={() => actions.updateBot(bot.id, (b) => ({ ...b, codeHook: code }))}>{dirty ? 'Deploy' : 'Deployed'}</Button>
        </>}
      >
        <div className="text-xs text-muted mb-2 flex items-center gap-2">
          <Badge tone="orange">Runtime: JavaScript (worker)</Badge>
          Used by intents: {bot.intents.filter((i) => i.fulfillmentEnabled).map((i) => i.name).join(', ') || 'none — enable it on an intent'}
        </div>
        <textarea
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              const t = e.target; const s = t.selectionStart;
              setCode(code.slice(0, s) + '  ' + code.slice(t.selectionEnd));
              requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
            }
          }}
          className="w-full h-[420px] font-mono text-[12.5px] leading-relaxed bg-[#0f1b2a] text-[#d4e1f0] rounded-lg p-4 outline-none focus:ring-2 focus:ring-link/40 scroll-thin"
        />
      </Container>

      <Container title="Test event" actions={<Button icon={Play} onClick={test}>Invoke</Button>}>
        <Field label="Intent" className="max-w-xs mb-3">
          <Select value={intentName} onChange={(e) => setIntentName(e.target.value)}>{bot.intents.map((i) => <option key={i.id}>{i.name}</option>)}</Select>
        </Field>
        <div className="grid lg:grid-cols-2 gap-4">
          <div><div className="text-xs font-semibold mb-1">Event</div><Code className="h-72">{JSON.stringify(sampleEvent(bot, intentName), null, 2)}</Code></div>
          <div>
            <div className="text-xs font-semibold mb-1 flex items-center gap-2">Response {result && <Badge tone={result.ok ? 'green' : 'red'}>{result.ok ? 'Succeeded' : 'Failed'} · {result.ms} ms</Badge>}</div>
            {result ? (
              <>
                <Code className="h-44">{result.ok ? JSON.stringify(result.result, null, 2) : result.error}</Code>
                <div className="text-xs font-semibold mt-2 mb-1">Log output</div>
                <Code className="h-20">{(result.logs || []).join('\n') || '(no logs)'}</Code>
              </>
            ) : <Alert>Click <b>Invoke</b> to run the code hook with this event.</Alert>}
          </div>
        </div>
      </Container>
    </div>
  );
}
