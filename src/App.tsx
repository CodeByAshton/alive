import { useEffect, useRef, useState } from 'react';
import { startSync, surface } from './lib/sync';
import { useVault } from './lib/store';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { Chat } from './components/Chat';
import { Graph } from './components/Graph';
import { Phone } from './components/Phone';

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
  const [rightRail, setRightRail] = useState(true);
  const { ref: graphRef, size } = useSize<HTMLDivElement>();

  return (
    <div className="desktop">
      <Sidebar />
      <main className="main">
        <div className="main-split">
          <section className="pane editor-pane">
            <Editor />
          </section>
          <section className="pane chat-pane">
            <Chat />
          </section>
        </div>
      </main>
      {rightRail && (
        <aside className="right-rail" ref={graphRef}>
          <div className="rail-header">
            <span>Graph</span>
            <button onClick={() => setRightRail(false)}>×</button>
          </div>
          <Graph width={size.width} height={size.height - 36} />
        </aside>
      )}
      {!rightRail && (
        <button className="rail-reveal" onClick={() => setRightRail(true)} title="Show graph">
          ◧
        </button>
      )}
    </div>
  );
}

export default function App() {
  const hydrated = useVault((s) => s.hydrated);

  useEffect(() => {
    startSync();
  }, []);

  if (!hydrated) return <div className="boot">Opening vault…</div>;
  return surface === 'phone' ? <Phone /> : <Desktop />;
}
