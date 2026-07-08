// Sidebar: create actions at the top, menu items (Files / Chats / Skills /
// Devices), and the active section below. Notion/Linear-flavored — rows on a
// soft gray canvas, hairlines, rounded corners.

import { useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  CirclePause,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  MessageSquare,
  MonitorSmartphone,
  MoreHorizontal,
  PencilLine,
  Plus,
  SquarePen,
  Cable,
  SlidersHorizontal,
  Trash2,
  Waypoints,
  Zap,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useVault } from '../lib/store';
import { deletePath, movePath, putRecord, setAssistantPaused } from '../lib/sync';
import { createChat, getChatConfig, listChats } from '../lib/chat';
import type { VaultRecord } from '../lib/types';
import { SettingsDialog } from './SettingsDialog';
import { ConfirmDialog, NameDialog, type ConfirmPrompt, type NamePrompt } from './dialogs';

/* ── shared dialog state, exposed to panels via callbacks ─────────────── */

interface DialogApi {
  ask: (prompt: NamePrompt) => void;
  confirm: (prompt: ConfirmPrompt) => void;
}

/* ── tree ─────────────────────────────────────────────────────────────── */

interface TreeNode {
  path: string;
  name: string;
  type: 'file' | 'folder';
  children: TreeNode[];
}

function buildTree(records: Map<string, VaultRecord>): TreeNode[] {
  const roots: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();
  const sorted = [...records.values()]
    .filter((r) => !r.path.startsWith('.'))
    .sort((a, b) => a.path.localeCompare(b.path));

  for (const rec of sorted) {
    const node: TreeNode = { path: rec.path, name: rec.path.split('/').pop()!, type: rec.type, children: [] };
    byPath.set(rec.path, node);
    const parent = byPath.get(rec.path.split('/').slice(0, -1).join('/'));
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

function Node({ node, depth, dialogs }: { node: TreeNode; depth: number; dialogs: DialogApi }) {
  const activePath = useVault((s) => s.activePath);
  const openFile = useVault((s) => s.openFile);
  const setActiveChat = useVault((s) => s.setActiveChat);
  const [open, setOpen] = useState(depth < 1);

  const isChat = /^chats\/[^/]+$/.test(node.path);
  const active = activePath === node.path;

  const onClick = () => {
    if (isChat) setActiveChat(node.path);
    else if (node.type === 'folder') setOpen(!open);
    else openFile(node.path, 'read');
  };

  const IconComp = isChat ? MessageSquare : node.type === 'folder' ? (open ? FolderOpen : Folder) : FileText;

  return (
    <div>
      <div
        className={cn(
          'tree-row group flex h-7 cursor-pointer items-center gap-1.5 rounded-lg pr-1 text-[13px] text-neutral-600 transition-colors select-none',
          'hover:bg-neutral-200/55 hover:text-neutral-900',
          active && 'bg-white text-neutral-900 shadow-xs'
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={onClick}
      >
        {node.type === 'folder' && !isChat ? (
          <ChevronRight
            className={cn('size-3 shrink-0 text-neutral-400 transition-transform duration-150', open && 'rotate-90')}
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <IconComp className="size-[15px] shrink-0 text-neutral-400" />
        <span className="tree-name flex-1 truncate">{node.name.replace(/\.md$/, '')}</span>
        <span onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                title="Actions"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {node.type === 'folder' && !isChat && (
                <>
                  <DropdownMenuItem
                    onClick={() =>
                      dialogs.ask({
                        title: 'New note',
                        placeholder: 'Note name',
                        onSubmit: async (name) => {
                          const path = `${node.path}/${name.replace(/\.md$/, '')}.md`;
                          await putRecord(path, 'file', `# ${name}\n`);
                          openFile(path, 'edit');
                          setOpen(true);
                        },
                      })
                    }
                  >
                    <Plus /> New note inside
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                onClick={() =>
                  dialogs.ask({
                    title: 'Rename / move',
                    description: 'Edit the full path to rename or move.',
                    initial: node.path,
                    action: 'Save',
                    onSubmit: async (to) => {
                      if (to === node.path) return;
                      await movePath(node.path, to.replace(/\.md$/, '') + (node.type === 'file' ? '.md' : ''));
                    },
                  })
                }
              >
                <PencilLine /> Rename / move
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() =>
                  dialogs.confirm({
                    title: `Delete ${node.name.replace(/\.md$/, '')}?`,
                    description:
                      node.type === 'folder' ? 'Everything inside this folder will be deleted.' : undefined,
                    onConfirm: () => deletePath(node.path),
                  })
                }
              >
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      {node.type === 'folder' && open && !isChat && (
        <div>
          {node.children.map((child) => (
            <Node key={child.path} node={child} depth={depth + 1} dialogs={dialogs} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilesSection({ dialogs }: { dialogs: DialogApi }) {
  const records = useVault((s) => s.records);
  const tree = useMemo(() => buildTree(records), [records]);
  return (
    <div className="tree flex flex-col gap-px">
      {tree.map((node) => (
        <Node key={node.path} node={node} depth={0} dialogs={dialogs} />
      ))}
    </div>
  );
}

/* ── chats ────────────────────────────────────────────────────────────── */

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function ChatsSection() {
  const records = useVault((s) => s.records);
  const activeChat = useVault((s) => s.activeChat);
  const setActiveChat = useVault((s) => s.setActiveChat);
  const chats = useMemo(() => listChats(records), [records]);

  return (
    <div className="panel-list flex flex-col gap-px">
      {chats.map((c) => (
        <div
          key={c.path}
          className={cn(
            'panel-row flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2 text-[13px] text-neutral-600 transition-colors select-none',
            'hover:bg-neutral-200/55 hover:text-neutral-900',
            activeChat === c.path && 'bg-white text-neutral-900 shadow-xs'
          )}
          onClick={() => setActiveChat(c.path)}
        >
          <MessageSquare className="size-[15px] shrink-0 text-neutral-400" />
          <span className="flex-1 truncate">{c.title}</span>
          <span className="font-mono text-[10px] text-neutral-400">{timeAgo(c.mtime)}</span>
        </div>
      ))}
      {!chats.length && <div className="px-2 py-4 text-xs text-neutral-400">No chats yet.</div>}
    </div>
  );
}

/* ── devices ──────────────────────────────────────────────────────────── */

function DevicesSection() {
  const presence = useVault((s) => s.presence);
  const paused = useVault((s) => s.paused);
  return (
    <div className="presence-panel flex flex-col gap-px">
      {/* Kill switch: pausing stops the assistant everywhere, instantly. */}
      <div className="pause-row mb-2 flex items-center gap-2 rounded-lg border bg-white px-2.5 py-2 shadow-xs">
        <CirclePause className={cn('size-3.5 shrink-0', paused ? 'text-neutral-800' : 'text-neutral-400')} />
        <span className="flex-1 text-xs font-medium text-neutral-700">
          {paused ? 'Assistant paused' : 'Pause assistant'}
        </span>
        <Switch checked={paused} onCheckedChange={setAssistantPaused} aria-label="Pause assistant" />
      </div>
      {presence.map((d) => (
        <div key={d.deviceId} className="presence-row flex h-8 items-center gap-2 rounded-lg px-2 text-[13px]">
          <span
            className={cn('size-1.5 rounded-full', d.state === 'active' ? 'bg-neutral-800' : 'bg-neutral-300')}
          />
          <span className="flex-1 truncate font-mono text-xs text-neutral-600">{d.deviceId}</span>
          <span className="text-[11px] text-neutral-400">{d.state === 'active' ? d.deviceType : 'away'}</span>
        </div>
      ))}
      {presence.length === 0 && <div className="presence-row px-2 py-4 text-xs text-neutral-400">no devices</div>}
      <p className="px-2 pt-3 text-[11px] leading-relaxed text-neutral-400">
        What the assistant can do is assembled from the devices that are on right now. Turn a computer into one:
      </p>
      <code className="mx-2 mt-1.5 block overflow-x-auto rounded-lg border bg-white px-2.5 py-1.5 font-mono text-[11px] whitespace-nowrap text-neutral-600">
        npm run node-harness
      </code>
    </div>
  );
}

/* ── container ────────────────────────────────────────────────────────── */

const MENU = [
  { id: 'files', icon: Folder, label: 'Files' },
  { id: 'chats', icon: MessageSquare, label: 'Chats' },
  { id: 'customize', icon: SlidersHorizontal, label: 'Customize' },
  { id: 'graph', icon: Waypoints, label: 'Graph' },
  { id: 'devices', icon: MonitorSmartphone, label: 'Devices' },
] as const;

// Claude-style Customize entry: a hover dropdown holding Skills + Connectors.
function CustomizeItem({ className }: { className: (active: boolean) => string }) {
  const mainView = useVault((s) => s.mainView);
  const setMainView = useVault((s) => s.setMainView);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const openNow = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          title="Customize"
          className={className(mainView === 'skills' || mainView === 'connectors')}
          onMouseEnter={openNow}
          onMouseLeave={closeSoon}
        >
          <SlidersHorizontal className="size-4 text-neutral-400" />
          <span className="flex-1 text-left">Customize</span>
          <ChevronRight className="size-3 text-neutral-300" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={4}
        className="customize-menu w-44"
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
      >
        <DropdownMenuItem onClick={() => setMainView('skills')}>
          <Zap /> Skills
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setMainView('connectors')}>
          <Cable /> Connectors
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Sidebar() {
  const railTab = useVault((s) => s.railTab);
  const setRailTab = useVault((s) => s.setRailTab);
  const mainView = useVault((s) => s.mainView);
  const setMainView = useVault((s) => s.setMainView);
  const connected = useVault((s) => s.connected);
  const presence = useVault((s) => s.presence);
  const openFile = useVault((s) => s.openFile);
  const setActiveChat = useVault((s) => s.setActiveChat);
  const records = useVault((s) => s.records);

  const [namePrompt, setNamePrompt] = useState<NamePrompt | null>(null);
  const [confirmPrompt, setConfirmPrompt] = useState<ConfirmPrompt | null>(null);
  const dialogs: DialogApi = { ask: setNamePrompt, confirm: setConfirmPrompt };

  const activeDevices = presence.filter((d) => d.state === 'active').length;

  const newNote = () =>
    dialogs.ask({
      title: 'New note',
      placeholder: 'Note name',
      onSubmit: async (name) => {
        const path = `notes/${name.replace(/\.md$/, '')}.md`;
        await putRecord(path, 'file', `# ${name}\n`);
        openFile(path, 'edit');
        setRailTab('files');
      },
    });

  const newFolder = () =>
    dialogs.ask({
      title: 'New folder',
      placeholder: 'Folder name',
      onSubmit: async (name) => {
        await putRecord(name, 'folder');
        setRailTab('files');
      },
    });

  const newChat = async () => {
    const config = { provider: 'anthropic', model: 'claude-opus-4-8' };
    setActiveChat(await createChat(getChatConfigSafe(records) ?? config));
  };

  return (
    <aside className="sidebar flex w-60 shrink-0 flex-col px-3 pt-3 pb-2">
      {/* header + create actions at the top */}
      <div className="mb-3 flex items-center gap-2 px-1">
        <span className="text-sm font-semibold tracking-tight">Vault</span>
        <span
          className={cn('sync-dot size-1.5 rounded-full', connected ? 'on bg-neutral-800' : 'off bg-neutral-300')}
          title={connected ? 'Synced' : 'Offline'}
        />
        <span className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" title="New note" onClick={newNote}>
              <SquarePen className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New note</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" title="New folder" onClick={newFolder}>
              <FolderPlus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New folder</TooltipContent>
        </Tooltip>
        <SettingsDialog />
      </div>

      {/* menu items */}
      <nav className="mb-2 flex flex-col gap-px">
        {MENU.map((item) => {
          const navCls = (active: boolean) =>
            cn(
              'nav-item group flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 text-[13px] font-medium text-neutral-600 transition-colors select-none',
              'hover:bg-neutral-200/55 hover:text-neutral-900',
              active && 'bg-white text-neutral-900 shadow-xs'
            );
          if (item.id === 'customize') return <CustomizeItem key={item.id} className={navCls} />;
          return (
          <button
            key={item.id}
            title={item.label}
            className={navCls(item.id === 'graph' ? mainView === 'graph' : railTab === item.id)}
            onClick={() => {
              if (item.id === 'graph') {
                setMainView('graph');
                return;
              }
              setRailTab(item.id);
              if (item.id === 'chats') setMainView('chat');
            }}
          >
            <item.icon className="size-4 text-neutral-400" />
            <span className="flex-1 text-left">{item.label}</span>
            {item.id === 'devices' && activeDevices > 0 && (
              <Badge variant="secondary" className="h-4 min-w-4 px-1 font-mono text-[10px]">
                {activeDevices}
              </Badge>
            )}
            {item.id === 'chats' && (
              <span
                role="button"
                title="New chat"
                className="rounded-md p-0.5 text-neutral-400 opacity-0 transition-opacity hover:text-neutral-900 group-hover:opacity-100 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  newChat();
                }}
              >
                <Plus className="size-3.5" />
              </span>
            )}
          </button>
          );
        })}
      </nav>

      <div className="mx-1 mb-2 h-px bg-neutral-200/70" />

      {/* active section */}
      <div className="quiet-scroll -mx-1 flex-1 overflow-y-auto px-1">
        {railTab === 'files' && <FilesSection dialogs={dialogs} />}
        {railTab === 'chats' && <ChatsSection />}
        {railTab === 'devices' && <DevicesSection />}
      </div>

      <NameDialog prompt={namePrompt} onClose={() => setNamePrompt(null)} />
      <ConfirmDialog prompt={confirmPrompt} onClose={() => setConfirmPrompt(null)} />
    </aside>
  );
}

function getChatConfigSafe(records: Map<string, VaultRecord>) {
  const chats = listChats(records);
  return chats.length ? getChatConfig(records, chats[0].path) : null;
}
