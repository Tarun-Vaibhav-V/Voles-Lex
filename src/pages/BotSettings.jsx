import { actions } from '../store.js';
import { Container, Field, Input, Textarea } from '../components/ui.jsx';

export default function BotSettings({ bot }) {
  const set = (patch) => actions.updateBot(bot.id, (b) => ({ ...b, ...patch }));
  return (
    <div className="space-y-5">
      <Container title="Bot details">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Bot name"><Input value={bot.name} onChange={(e) => set({ name: e.target.value.replace(/[^\w-]/g, '') })} /></Field>
          <Field label="Language"><Input value="English (US) — en_US" disabled /></Field>
          <Field label="Description" className="md:col-span-2"><Input value={bot.description} onChange={(e) => set({ description: e.target.value })} /></Field>
          <Field label="Welcome message" hint="Spoken when a voice session starts." className="md:col-span-2"><Input value={bot.welcome || ''} onChange={(e) => set({ welcome: e.target.value })} /></Field>
        </div>
      </Container>
      <Container title="Conversation settings">
        <div className="grid md:grid-cols-2 gap-6">
          <Field label={`Intent classification confidence threshold: ${bot.nluThreshold.toFixed(2)}`} hint="Below this score the FallbackIntent is triggered.">
            <input type="range" min="0" max="1" step="0.05" value={bot.nluThreshold} onChange={(e) => set({ nluThreshold: +e.target.value })} className="w-full accent-[#ec7211]" />
          </Field>
          <Field label="Idle session timeout (seconds)" hint="Session state is discarded after this much inactivity.">
            <Input type="number" min="60" max="86400" value={bot.idleSessionTTL} onChange={(e) => set({ idleSessionTTL: +e.target.value })} />
          </Field>
          <Field label="Fallback message" className="md:col-span-2"><Textarea rows={2} value={bot.fallbackMessage} onChange={(e) => set({ fallbackMessage: e.target.value })} /></Field>
        </div>
      </Container>
    </div>
  );
}
