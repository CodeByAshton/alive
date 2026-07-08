// Force-directed graph: notes are nodes, [[wikilinks]] are edges. Chat
// folders appear as nodes too, linked to notes their messages reference.

import { useMemo, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useVault } from '../lib/store';
import { buildGraph } from '../lib/wikilinks';

const COLORS: Record<string, string> = {
  note: '#737373',
  chat: '#171717',
  skill: '#a3a3a3',
};

export function Graph({ width, height }: { width: number; height: number }) {
  const records = useVault((s) => s.records);
  const activePath = useVault((s) => s.activePath);
  const openFile = useVault((s) => s.openFile);
  const setActiveChat = useVault((s) => s.setActiveChat);
  const graphRef = useRef<any>(null);

  const data = useMemo(() => {
    const { nodes, links } = buildGraph(records);
    return { nodes: nodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })) };
  }, [records]);

  return (
    <ForceGraph2D
      ref={graphRef}
      width={width}
      height={height}
      graphData={data}
      backgroundColor="rgba(0,0,0,0)"
      nodeId="id"
      nodeLabel="label"
      linkColor={() => 'rgba(0,0,0,0.10)'}
      linkWidth={1}
      cooldownTicks={80}
      onNodeClick={(node: any) => {
        if (node.kind === 'chat') setActiveChat(node.id);
        else openFile(node.id, 'read');
      }}
      nodeCanvasObject={(node: any, ctx, globalScale) => {
        const isActive = node.id === activePath;
        const r = node.kind === 'chat' ? 5 : 4;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = COLORS[node.kind] ?? COLORS.note;
        ctx.fill();
        if (isActive) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 2.5, 0, 2 * Math.PI);
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        if (globalScale > 1.2) {
          ctx.font = `${10 / globalScale}px -apple-system, sans-serif`;
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.textAlign = 'center';
          ctx.fillText(node.label, node.x, node.y + r + 8 / globalScale);
        }
      }}
    />
  );
}
