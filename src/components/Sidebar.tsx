// Left navigation: a narrow icon rail (Files / Chats / Skills / Devices)
// driving a sidebar panel — plus the live connection state.

import { useMemo, useState } from 'react';
import { useVault } from '../lib/store';
import { deletePath, movePath, putRecord } from '../lib/sync';
import { createChat, getChatConfig, listChats } from '../lib/chat';
import { parseFrontmatter, serializeFrontmatter } from '../../shared/frontmatter.mjs';
import type { VaultRecord } from '../lib/types';
import { Icon } from './Icon';

/* ── icon rail ─────────────────────────────────────────────────────────── */

const TABS = [
  { id: 'files', icon: 'folder', label: 'Files' },
  { id: 'chats', icon: 'chat', label: 'Chats' },
  { id: 'skills', icon: 'skill', label: 'Skills' },
  { id: 'devices', icon: 'devices', label: 'Devices' },
] as const;

function Rail() {
  const railTab = useVault((s) => s.railTab);
  const setRailTab = useVault((s) => s.setRailTab);
  const connected = useVault((s) => s.connected);
  const presence = useVault((s) => s.presence);
  const activeDevices = presence.filter((d) => d.state === 'active').length;

  return (
    <nav className="rail">
      <div className={`rail-mark ${connected ? 'on' : 'off'}`} title={connected ? 'Synced' : 'Offline'}>
        V
      </div>
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`rail-tab ${railTab === t.id ? 'active' : ''}`}
          title={t.label}
          onClick={() => setRailTab(t.id)}
        >
          <Icon name={t.icon} />
          {t.id === 'devices' && activeDevices > 0 && <span className="rail-badge">{activeDevices}</span>}
        </button>
      ))}
    </nav>
  );
}

/* ── files panel ───────────────────────────────────────────────────────── */

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
  const [open, setOpen] = useState(depth < 1);

  const isChat = /^chats\/[^/]+$/.test(node.path);

  const onClick = () => {
    if (isChat) setActiveChat(node.path);
    else if (node.type === 'folder') setOpen(!open);
    else setActivePath(node.path);
  };

  return (
    <div>
      <div
        className={`tree-row ${activePath === node.path ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 13 }}
        onClick={onClick}
      >
        <span className="tree-icon">
          <Icon name={isChat ? 'chat' : node.type === 'folder' ? (open ? 'folderOpen' : 'folder') : 'file'} size={13} />
        </span>
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

function FilesPanel() {
  const records = useVault((s) => s.records);
  const setActivePath = useVault((s) => s.setActivePath);
  const tree = useMemo(() => buildTree(records), [records]);

  return (
    <>
      <div className="panel-header">
        <span>Files</span>
        <div className="panel-actions">
          <button
            title="New note"
            onClick={async () => {
              const name = prompt('Note name');
              if (!name) return;
              const path = `notes/${name.replace(/\.md$/, '')}.md`;
              await putRecord(path, 'file', `# ${name}\n`);
              setActivePath(path);
            }}
          >
            <Icon name="file" size={13} /> +
          </button>
          <button
            title="New folder"
            onClick={async () => {
              const name = prompt('Folder name');
              if (name) await putRecord(name, 'folder');
            }}
          >
            <Icon name="folder" size={13} /> +
          </button>
        </div>
      </div>
      <div className="tree">
        {tree.map((node) => (
          <Node key={node.path} node={node} depth={0} />
        ))}
      </div>
    </>
  );
}

/* ── chats panel ───────────────────────────────────────────────────────── */

function ChatsPanel() {
  const records = useVault((s) => s.records);
  const activeChat = useVault((s) => s.activeChat);
  const setActiveChat = useVault((s) => s.setActiveChat);
  const chats = useMemo(() => listChats(records), [records]);

  return (
    <>
      <div className="panel-header">
        <span>Chats</span>
        <div className="panel-actions">
          <button
            title="New chat"
            onClick={async () => {
              const config = activeChat
                ? getChatConfig(records, activeChat)
                : { provider: 'anthropic', model: 'claude-opus-4-8' };
              setActiveChat(await createChat(config));
            }}
          >
            <Icon name="plus" size={13} /> New
          </button>
        </div>
      </div>
      <div className="panel-list">
        {chats.map((c) => (
          <div
            key={c.path}
            className={`panel-row ${activeChat === c.path ? 'active' : ''}`}
            onClick={() => setActiveChat(c.path)}
          >
            <Icon name="chat" size={13} />
            <span className="panel-row-title">{c.title}</span>
            <span className="panel-row-meta mono">{timeAgo(c.mtime)}</span>
          </div>
        ))}
        {!chats.length && <div className="panel-empty">No chats yet.</div>}
      </div>
    </>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/* ── skills panel ──────────────────────────────────────────────────────── */

const SKILL_TEMPLATE = (name: string, trigger: string) =>
  serializeFrontmatter(
    { name, trigger, description: 'Describe what this skill does.' },
    'Instructions the assistant follows when this skill is invoked. Write them like you would brief a colleague.\n'
  );

function SkillsPanel() {
  const records = useVault((s) => s.records);
  const activePath = useVault((s) => s.activePath);
  const setActivePath = useVault((s) => s.setActivePath);

  const skills = useMemo(() => {
    const out: { path: string; name: string; trigger: string; description: string }[] = [];
    for (const rec of records.values()) {
      if (rec.type !== 'file' || !rec.path.startsWith('skills/') || !rec.path.endsWith('.md')) continue;
      const { data } = parseFrontmatter(rec.content);
      out.push({
        path: rec.path,
        name: String(data.name || rec.path.split('/').pop()!.replace(/\.md$/, '')),
        trigger: String(data.trigger || ''),
        description: String(data.description || ''),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [records]);

  return (
    <>
      <div className="panel-header">
        <span>Skills</span>
        <div className="panel-actions">
          <button
            title="New skill"
            onClick={async () => {
              const name = prompt('Skill name (the trigger becomes /name)');
              if (!name) return;
              const slug = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
              const path = `skills/${slug}.md`;
              await putRecord(path, 'file', SKILL_TEMPLATE(name, `/${slug}`));
              setActivePath(path);
            }}
          >
            <Icon name="plus" size={13} /> New
          </button>
        </div>
      </div>
      <div className="panel-list">
        {skills.map((s) => (
          <div
            key={s.path}
            className={`panel-row tall ${activePath === s.path ? 'active' : ''}`}
            onClick={() => setActivePath(s.path)}
          >
            <Icon name="skill" size={13} />
            <span className="panel-row-title">
              {s.name}
              <span className="panel-row-sub">
                <span className="mono">{s.trigger}</span> — {s.description}
              </span>
            </span>
          </div>
        ))}
        {!skills.length && <div className="panel-empty">No skills yet — they're just files in skills/.</div>}
      </div>
      <div className="panel-footnote">Skills are vault files. Invoke one in chat with its slash command.</div>
    </>
  );
}

/* ── devices panel ─────────────────────────────────────────────────────── */

function DevicesPanel() {
  const presence = useVault((s) => s.presence);

  return (
    <>
      <div className="panel-header">
        <span>Devices</span>
      </div>
      <div className="presence-panel">
        {presence.map((d) => (
          <div key={d.deviceId} className="presence-row">
            <span className={`presence-state ${d.state}`}>●</span>
            <span className="mono">{d.deviceId}</span>
            <span className="presence-state">{d.state === 'active' ? d.deviceType : 'away'}</span>
          </div>
        ))}
        {presence.length === 0 && <div className="presence-row dim">no devices</div>}
      </div>
      <div className="panel-footnote">
        What the assistant can do is assembled from the devices that are on right now — phones keep it
        conversational, a desktop lets it edit the vault, and a connected machine lets it run commands.
        <div className="panel-code mono">npm run node-harness -- --workspace ~/dev</div>
        turns a computer into one of those machines.
      </div>
    </>
  );
}

/* ── container ─────────────────────────────────────────────────────────── */

export function Sidebar() {
  const railTab = useVault((s) => s.railTab);
  return (
    <div className="left-nav">
      <Rail />
      <aside className="sidebar">
        {railTab === 'files' && <FilesPanel />}
        {railTab === 'chats' && <ChatsPanel />}
        {railTab === 'skills' && <SkillsPanel />}
        {railTab === 'devices' && <DevicesPanel />}
      </aside>
    </div>
  );
}
