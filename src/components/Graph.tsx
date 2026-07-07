// Force-directed graph: notes are nodes, [[wikilinks]] are edges. Chat
// folders appear as nodes too, linked to notes their messages reference.

import { useMemo, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useVault } from '../lib/store';
import { buildGraph } from '../lib/wikilinks';

const COLORS: Record<string, string> = {
  note: '#8f959e',
  chat: '#6d9ee8',
  skill: '#b8a06a',
};

export function Graph({ width, height }: { width: number; height: number }) {
  const records = useVault((s) => s.records);
  const activePath = useVault((s) => s.activePath);
  const setActivePath = useVault((s) => s.setActivePath);
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
      linkColor={() => 'rgba(140,150,165,0.28)'}
      linkWidth={1}
      cooldownTicks={80}
      onNodeClick={(node: any) => {
        if (node.kind === 'chat') setActiveChat(node.id);
        else setActivePath(node.id);
      }}
      nodeCanvasObject={(node: any, ctx, globalScale) => {
        const isActive = node.id === activePath;
        const r = node.kind === 'chat' ? 5 : 4;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = isActive ? '#e6e9ef' : COLORS[node.kind] ?? COLORS.note;
        ctx.shadowColor = ctx.fillStyle as string;
        ctx.shadowBlur = isActive ? 12 : 6;
        ctx.fill();
        ctx.shadowBlur = 0;
        if (globalScale > 1.2) {
          ctx.font = `${10 / globalScale}px -apple-system, sans-serif`;
          ctx.fillStyle = 'rgba(200,205,215,0.75)';
          ctx.textAlign = 'center';
          ctx.fillText(node.label, node.x, node.y + r + 8 / globalScale);
        }
      }}
    />
  );
}
