import { useMemo, useState } from 'react';
import { useVault } from '../lib/store';
import { deletePath, movePath, putRecord } from '../lib/sync';
import type { VaultRecord } from '../lib/types';

interface TreeNode {
  path: string;
  name: string;
  type: 'file' | 'folder';
  children: TreeNode[];
}

function buildTree(records: Map<string, VaultRecord>): TreeNode[] {
  const roots: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();
  const sorted = [...records.values()].sort((a, b) => a.path.localeCompare(b.path));

  for (const rec of sorted) {
    const node: TreeNode = {
      path: rec.path,
      name: rec.path.split('/').pop()!,
      type: rec.type,
      children: [],
    };
    byPath.set(rec.path, node);
    const parentPath = rec.path.split('/').slice(0, -1).join('/');
    const parent = byPath.get(parentPath);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

function Node({ node, depth }: { node: TreeNode; depth: number }) {
  const activePath = useVault((s) => s.activePath);
  const setActivePath = useVault((s) => s.setActivePath);
  const setActiveChat = useVault((s) => s.setActiveChat);
  const [open, setOpen] = useState(depth < 1 || node.path === 'notes');

  const isChat = /^chats\/[^/]+$/.test(node.path);

  const onClick = () => {
    if (isChat) {
      setActiveChat(node.path);
    } else if (node.type === 'folder') {
      setOpen(!open);
    } else {
      setActivePath(node.path);
    }
  };

  return (
    <div>
      <div
        className={`tree-row ${activePath === node.path ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={onClick}
      >
        <span className="tree-icon">{node.type === 'folder' ? (isChat ? '💬' : open ? '▾' : '▸') : '·'}</span>
        <span className="tree-name">{node.name.replace(/\.md$/, '')}</span>
        <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
          {node.type === 'folder' && !isChat && (
            <button
              title="New note here"
              onClick={async () => {
                const name = prompt('Note name');
                if (!name) return;
                const path = `${node.path}/${name.replace(/\.md$/, '')}.md`;
                await putRecord(path, 'file', `# ${name}\n`);
                setActivePath(path);
                setOpen(true);
              }}
            >
              +
            </button>
          )}
          <button
            title="Rename / move"
            onClick={async () => {
              const to = prompt('New path', node.path);
              if (!to || to === node.path) return;
              await movePath(node.path, to.replace(/\.md$/, '') + (node.type === 'file' ? '.md' : ''));
            }}
          >
            ✎
          </button>
          <button
            title="Delete"
            onClick={async () => {
              if (confirm(`Delete ${node.path}?`)) await deletePath(node.path);
            }}
          >
            ×
          </button>
        </span>
      </div>
      {node.type === 'folder' && open && !isChat && (
        <div>
          {node.children.map((child) => (
            <Node key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const records = useVault((s) => s.records);
  const connected = useVault((s) => s.connected);
  const presence = useVault((s) => s.presence);
  const setActivePath = useVault((s) => s.setActivePath);
  const tree = useMemo(() => buildTree(records), [records]);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="app-title">Vault</span>
        <span className={`conn-dot ${connected ? 'on' : 'off'}`} title={connected ? 'Synced' : 'Offline'} />
      </div>
      <div className="sidebar-toolbar">
        <button
          onClick={async () => {
            const name = prompt('Note name');
            if (!name) return;
            const path = `notes/${name.replace(/\.md$/, '')}.md`;
            await putRecord(path, 'file', `# ${name}\n`);
            setActivePath(path);
          }}
        >
          + Note
        </button>
        <button
          onClick={async () => {
            const name = prompt('Folder name');
            if (name) await putRecord(name, 'folder');
          }}
        >
          + Folder
        </button>
      </div>
      <div className="tree">
        {tree.map((node) => (
          <Node key={node.path} node={node} depth={0} />
        ))}
      </div>
      <div className="presence-panel">
        <div className="presence-title">Devices</div>
        {presence.map((d) => (
          <div key={d.deviceId} className="presence-row">
            <span>{d.deviceType === 'phone' ? '📱' : '💻'}</span>
            <span className="mono">{d.deviceId}</span>
            <span className={`presence-state ${d.state}`}>{d.state}</span>
          </div>
        ))}
        {presence.length === 0 && <div className="presence-row dim">no devices</div>}
      </div>
    </aside>
  );
}
