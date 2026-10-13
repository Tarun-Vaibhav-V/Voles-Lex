import { useMemo, useState } from 'react';
import { Download, FileJson, FolderTree, Server } from 'lucide-react';
import { downloadJSON, downloadLexZip, toLexJson } from '../engine/exportLex.js';
import { Alert, Button, Code, Container } from '../components/ui.jsx';

export default function ExportPage({ bot }) {
  const files = useMemo(() => toLexJson(bot), [bot]);
  const paths = Object.keys(files).sort();
  const [sel, setSel] = useState(paths.find((p) => p.includes('/Intents/')) || paths[0]);

  return (
    <div className="space-y-5">
      <Container
        title="Export to Amazon Lex V2"
        description="Download this bot as a Lex V2 import package (LexJson). In the AWS console: Amazon Lex → Bots → Action → Import, then upload the zip."
        actions={<>
          <Button icon={FileJson} onClick={() => downloadJSON(bot, `${bot.name}.voxlex.json`)}>VoxLex JSON</Button>
          <Button variant="primary" icon={Download} onClick={() => downloadLexZip(bot)}>Download Lex zip</Button>
        </>}
      >
        <div className="grid md:grid-cols-[280px_1fr] gap-4">
          <div className="border border-line rounded-lg p-2 max-h-96 overflow-auto scroll-thin">
            <div className="text-xs font-semibold text-muted flex items-center gap-1 px-1 pb-1"><FolderTree size={13} /> Package contents</div>
            {paths.map((p) => (
              <button key={p} onClick={() => setSel(p)} className={`block w-full text-left font-mono text-[11.5px] px-1.5 py-1 rounded truncate ${sel === p ? 'bg-blue-50 text-link' : 'hover:bg-gray-50'}`} title={p}>
                {'  '.repeat(p.split('/').length - 1)}{p.split('/').at(-1)}
                <span className="text-muted"> {p.split('/').length > 2 ? `· ${p.split('/').at(-2)}` : ''}</span>
              </button>
            ))}
          </div>
          <Code className="max-h-96">{JSON.stringify(files[sel], null, 2)}</Code>
        </div>
        <Alert tone="info" className="mt-4">
          Note: the fulfillment Lambda isn't part of a Lex import — deploy your code hook as a Lambda function and attach it to the alias. In the cloud, intent understanding falls back to Lex's own NLU, so add enough sample utterances first (the <b>Logs & coach</b> page helps).
        </Alert>
      </Container>

      <Container title="Local runtime API" description="Run `npm run server` to expose this bot over a REST API shaped like the Lex V2 runtime (RecognizeText).">
        <div className="flex items-center gap-2 text-sm mb-2"><Server size={15} className="text-muted" /> Send a turn to the bot:</div>
        <Code>{`curl -s -X POST http://localhost:8787/bots/${bot.id}/botAliases/TestBotAlias/botLocales/en_US/sessions/demo-1/text \\
  -H 'Content-Type: application/json' \\
  -d '{"text": "${bot.intents[0]?.utterances[0] || 'hello'}", "nlu": "llm"}'`}</Code>
        <p className="text-xs text-muted mt-2">The test console publishes bots to the runtime server automatically when it is running.</p>
      </Container>
    </div>
  );
}
