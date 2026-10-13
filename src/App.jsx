import { useEffect, useState } from 'react';
import { Bot, Boxes, ChevronRight, Code2, Cpu, Download, GitBranch, Layers, LineChart, MessageSquareText, PiggyBank, Settings as Cog, SlidersHorizontal, Tags } from 'lucide-react';
import { useRoute, go } from './router.js';
import { useStore } from './store.js';
import { listOllamaModels } from './engine/llm.js';
import { cx } from './components/ui.jsx';
import BotsList from './pages/BotsList.jsx';
import Intents from './pages/Intents.jsx';
import IntentEditor from './pages/IntentEditor.jsx';
import SlotTypes from './pages/SlotTypes.jsx';
import Versions from './pages/Versions.jsx';
import Fulfillment from './pages/Fulfillment.jsx';
import Analytics from './pages/Analytics.jsx';
import ExportPage from './pages/Export.jsx';
import BotSettings from './pages/BotSettings.jsx';
import Settings from './pages/Settings.jsx';
import Dashboard from './pages/Dashboard.jsx';
import TestConsole from './components/TestConsole.jsx';

function useLlmStatus() {
  const settings = useStore((s) => s.settings);
  const [status, setStatus] = useState({ ok: null });
  useEffect(() => {
    if (settings.provider === 'webllm') { setStatus({ ok: true, label: 'WebLLM (in-browser)' }); return; }
    let alive = true;
    const check = () => listOllamaModels(settings.ollamaUrl)
      .then((m) => alive && setStatus({ ok: m.some((x) => x.name === settings.model), label: settings.model, missing: !m.some((x) => x.name === settings.model) }))
      .catch(() => alive && setStatus({ ok: false, label: 'Ollama offline' }));
    check();
    const t = setInterval(check, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [settings.provider, settings.ollamaUrl, settings.model]);
  return status;
}

const BOT_NAV = [
  { key: 'intents', label: 'Intents', icon: MessageSquareText },
  { key: 'slottypes', label: 'Slot types', icon: Tags },
  { key: 'fulfillment', label: 'Fulfillment (Lambda)', icon: Code2 },
  { key: 'versions', label: 'Versions & aliases', icon: GitBranch },
  { key: 'analytics', label: 'Logs & coach', icon: LineChart, badge: 'AI' },
  { key: 'export', label: 'Export to AWS', icon: Download },
  { key: 'settings', label: 'Bot settings', icon: SlidersHorizontal },
];

export default function App() {
  const route = useRoute();
  const bots = useStore((s) => s.bots);
  const llm = useLlmStatus();
  const [testOpen, setTestOpen] = useState(false);

  const botId = route[0] === 'bots' && route[1];
  const bot = botId && bots.find((b) => b.id === botId);
  const section = route[2] || 'intents';

  let page;
  if (route[0] === 'settings') page = <Settings />;
  else if (route[0] === 'dashboard') page = <Dashboard />;
  else if (bot) {
    page = {
      intents: route[3] ? <IntentEditor bot={bot} intentId={route[3]} /> : <Intents bot={bot} />,
      slottypes: <SlotTypes bot={bot} selected={route[3]} />,
      fulfillment: <Fulfillment bot={bot} />,
      versions: <Versions bot={bot} />,
      analytics: <Analytics bot={bot} />,
      export: <ExportPage bot={bot} />,
      settings: <BotSettings bot={bot} />,
    }[section] || <Intents bot={bot} />;
  } else page = <BotsList />;

  return (
    <div className="h-full flex flex-col">
      {/* Top navigation (console style) */}
      <header className="h-12 bg-squid text-white flex items-center px-4 gap-4 shrink-0 z-20">
        <button onClick={() => go('bots')} className="flex items-center gap-2 font-bold tracking-tight">
          <svg width="24" height="24" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#ff9900" fillOpacity=".12" /><path d="M9 11v10M13 8v16M17 12v8M21 9v14M25 13v6" stroke="#ff9900" strokeWidth="2.6" strokeLinecap="round" /></svg>
          <span>Vox<span className="text-smile">Lex</span></span>
        </button>
        <span className="hidden sm:inline text-gray-300 text-[13px] border-l border-white/15 pl-4">Conversational AI · Lex V2 compatible</span>
        <div className="flex-1" />
        <button onClick={() => go('dashboard')} className="hidden md:flex items-center gap-1.5 text-[13px] text-gray-200 hover:text-white">
          <PiggyBank size={15} /> Cost & privacy
        </button>
        <button onClick={() => go('settings')} title="Local AI runtime" className={cx('flex items-center gap-2 text-xs rounded-full px-3 py-1 border', llm.ok ? 'border-green-400/50 bg-green-400/10' : llm.ok === false ? 'border-red-400/60 bg-red-400/10' : 'border-white/20')}>
          <span className={cx('w-2 h-2 rounded-full', llm.ok ? 'bg-green-400' : llm.ok === false ? 'bg-red-400' : 'bg-gray-400')} />
          <Cpu size={13} />
          <span className="hidden sm:inline">{llm.label || 'checking…'}{llm.missing ? ' (not pulled)' : ''}</span>
        </button>
        <span className="hidden lg:flex items-center gap-1 text-[13px] text-gray-300"><Layers size={14} /> local-1 (this device)</span>
        <button onClick={() => go('settings')} className="text-gray-300 hover:text-white"><Cog size={17} /></button>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Side navigation */}
        <nav className="hidden md:flex w-60 shrink-0 bg-white border-r border-line flex-col py-4 overflow-y-auto scroll-thin">
          <div className="px-5 pb-3 text-[15px] font-bold border-b border-line mb-3">Amazon Lex <span className="text-muted font-normal">(simulated)</span></div>
          <NavItem icon={Bot} active={!bot && route[0] === 'bots'} onClick={() => go('bots')}>Bots</NavItem>
          {bot && (
            <div className="mt-2">
              <div className="px-5 py-1.5 text-xs text-muted flex items-center gap-1"><Boxes size={12} /> <span className="truncate font-semibold text-ink">{bot.name}</span></div>
              <div className="px-5 text-[11px] text-muted uppercase tracking-wide mt-1 mb-1">Draft version · English (US)</div>
              {BOT_NAV.map((n) => (
                <NavItem key={n.key} icon={n.icon} indent active={section === n.key} onClick={() => go(`bots/${bot.id}/${n.key}`)}>
                  {n.label}{n.badge && <span className="ml-auto text-[10px] font-bold text-violet-700 bg-violet-100 rounded px-1">{n.badge}</span>}
                </NavItem>
              ))}
            </div>
          )}
          <div className="border-t border-line mt-4 pt-3">
            <NavItem icon={PiggyBank} active={route[0] === 'dashboard'} onClick={() => go('dashboard')}>Cost & privacy</NavItem>
            <NavItem icon={Cog} active={route[0] === 'settings'} onClick={() => go('settings')}>Local AI runtime</NavItem>
          </div>
          <div className="mt-auto px-5 pt-6 text-[11px] text-muted leading-relaxed">
            A student simulation of Amazon Lex V2. Not affiliated with AWS. Everything runs on this device.
          </div>
        </nav>

        <main className="flex-1 min-w-0 overflow-y-auto scroll-thin">
          <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
            {bot && <Breadcrumb bot={bot} section={section} sub={route[3]} />}
            <div key={route.slice(0, 4).join('/')}>{page}</div>
          </div>
        </main>

        {bot && testOpen && <TestConsole bot={bot} onClose={() => setTestOpen(false)} />}
      </div>

      {bot && !testOpen && (
        <button onClick={() => setTestOpen(true)} className="fixed bottom-5 right-5 z-30 h-11 px-5 rounded-full bg-action hover:bg-action-dark text-white font-semibold shadow-lg flex items-center gap-2">
          <MessageSquareText size={17} /> Test bot
        </button>
      )}
    </div>
  );
}

function NavItem({ icon: Icon, children, active, onClick, indent }) {
  return (
    <button onClick={onClick} className={cx('w-full flex items-center gap-2.5 py-1.5 text-[13.5px] text-left border-l-[3px]', indent ? 'pl-7 pr-4' : 'px-5', active ? 'border-action text-action-dark font-semibold bg-orange-50/60' : 'border-transparent text-ink hover:text-action')}>
      <Icon size={15} className="shrink-0" />{children}
    </button>
  );
}

function Breadcrumb({ bot, section, sub }) {
  const label = BOT_NAV.find((n) => n.key === section)?.label || 'Intents';
  const intent = sub && section === 'intents' && bot.intents.find((i) => i.id === sub);
  return (
    <div className="text-[13px] text-muted flex items-center gap-1 mb-3 flex-wrap">
      <button className="text-link hover:underline" onClick={() => go('bots')}>Bots</button><ChevronRight size={13} />
      <button className="text-link hover:underline" onClick={() => go(`bots/${bot.id}/intents`)}>{bot.name}</button><ChevronRight size={13} />
      {intent ? (<><button className="text-link hover:underline" onClick={() => go(`bots/${bot.id}/intents`)}>{label}</button><ChevronRight size={13} /><span>{intent.name}</span></>) : <span>{label}</span>}
    </div>
  );
}
