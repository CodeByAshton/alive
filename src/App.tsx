import { useEffect, useRef, useState } from 'react';

import { startSync, surface } from './lib/sync';
import { initNotifications } from './lib/notifications';
import { useVault } from './lib/store';
import { getServerConfig } from './lib/config';
import { hasSession, loadAuthConfig } from './lib/auth';
import { SignIn } from './components/SignIn';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { Chat } from './components/Chat';
import { Graph } from './components/Graph';
import { Phone } from './components/Phone';
import { Connect } from './components/Connect';
import { SkillsView } from './components/SkillsView';
import { ConnectorsView } from './components/ConnectorsView';
import { AutomationsView } from './components/AutomationsView';
import { CommandPalette } from './components/CommandPalette';

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 300, height: 300 });
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

function GraphView() {
  const { ref, size } = useSize<HTMLDivElement>();
  return (
    <div className="graph-view min-h-0 flex-1" ref={ref}>
      <Graph width={size.width} height={size.height} />
    </div>
  );
}

// Live notifications from automations and reflection — transient toasts on
// every surface; the durable copy is the .vault/notifications.md note.
function Notices() {
  const notices = useVault((s) => s.notices);
  const removeNotice = useVault((s) => s.removeNotice);
  if (!notices.length) return null;
  return (
    <div
      className="notices pointer-events-none fixed right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      style={{ bottom: 'calc(16px + env(safe-area-inset-bottom))' }}
    >
      {notices.map((n) => (
        <button
          key={n.id}
          className="notice pointer-events-auto cursor-pointer rounded-2xl border bg-white p-3.5 text-left shadow-md animate-in fade-in-0 slide-in-from-bottom-2"
          onClick={() => removeNotice(n.id)}
          title="Dismiss"
        >
          <span className="block text-[12px] font-semibold text-neutral-900">{n.title}</span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-neutral-600">{n.message}</span>
        </button>
      ))}
    </div>
  );
}

// One full-screen view at a time beside the sidebar: the chat, an open note,
// or the graph.
function Desktop() {
  const mainView = useVault((s) => s.mainView);

  return (
    <div className="desktop flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 p-2 pl-0">
        <section className="main-card flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-background shadow-xs">
          {/* Keyed on the view so switching sections animates in. */}
          <div key={mainView} className="view-fade flex min-h-0 min-w-0 flex-1 flex-col">
            {mainView === 'chat' && <Chat />}
            {mainView === 'note' && <Editor />}
            {mainView === 'graph' && <GraphView />}
            {mainView === 'skills' && <SkillsView />}
            {mainView === 'connectors' && <ConnectorsView />}
            {mainView === 'automations' && <AutomationsView />}
          </div>
        </section>
      </main>
      <CommandPalette />
    </div>
  );
}

export default function App() {
  const hydrated = useVault((s) => s.hydrated);
  const configured = getServerConfig() !== null;
  // 'loading' -> ask the server how it authenticates; 'signin' -> accounts
  // mode without a session; 'ready' -> sync running.
  const [auth, setAuth] = useState<'loading' | 'signin' | 'ready'>('loading');

  useEffect(() => {
    if (!configured) return;
    (async () => {
      const server = getServerConfig()!;
      const cfg = await loadAuthConfig(server.httpBase);
      if (cfg.auth === 'accounts' && !(await hasSession())) {
        setAuth('signin');
        return;
      }
      setAuth('ready');
      startSync();
      initNotifications();
    })();
  }, [configured]);

  if (!configured) return <Connect />;
  if (auth === 'signin')
    return (
      <SignIn
        onSignedIn={() => {
          setAuth('ready');
          startSync();
          initNotifications();
        }}
      />
    );
  if (auth === 'loading' || !hydrated)
    return <div className="boot grid h-full place-items-center text-sm text-neutral-400">Opening vault…</div>;
  return (
    <>
      {surface === 'phone' ? <Phone /> : <Desktop />}
      <Notices />
    </>
  );
}
