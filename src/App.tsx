import { useEffect, useRef, useState } from 'react';
import { Waypoints, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { startSync, surface } from './lib/sync';
import { useVault } from './lib/store';
import { getServerConfig } from './lib/config';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { Chat } from './components/Chat';
import { Graph } from './components/Graph';
import { Phone } from './components/Phone';
import { Connect } from './components/Connect';

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

function Desktop() {
  const [showGraph, setShowGraph] = useState(true);
  const { ref: graphRef, size } = useSize<HTMLDivElement>();

  return (
    <div className="desktop flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 gap-2 p-2 pl-0">
        <section className="editor-pane flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-background shadow-xs">
          <Editor />
        </section>
        <section className="chat-pane flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-background shadow-xs">
          <Chat />
        </section>
        {showGraph && (
          <section className="right-rail flex w-80 shrink-0 flex-col overflow-hidden rounded-2xl border bg-background shadow-xs">
            <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
              <span className="text-[11px] font-semibold tracking-wide text-neutral-400 uppercase">Graph</span>
              <Button variant="ghost" size="icon-sm" title="Hide graph" onClick={() => setShowGraph(false)}>
                <X className="size-3.5" />
              </Button>
            </header>
            <div className="min-h-0 flex-1" ref={graphRef}>
              <Graph width={size.width} height={size.height} />
            </div>
          </section>
        )}
        {!showGraph && (
          <Button
            variant="outline"
            size="icon-sm"
            className="rail-reveal absolute top-4 right-4 z-10 bg-background"
            title="Show graph"
            onClick={() => setShowGraph(true)}
          >
            <Waypoints className="size-4" />
          </Button>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const hydrated = useVault((s) => s.hydrated);
  const configured = getServerConfig() !== null;

  useEffect(() => {
    if (configured) startSync();
  }, [configured]);

  if (!configured) return <Connect />;
  if (!hydrated) return <div className="boot grid h-full place-items-center text-sm text-neutral-400">Opening vault…</div>;
  return surface === 'phone' ? <Phone /> : <Desktop />;
}
