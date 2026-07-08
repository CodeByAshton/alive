// Sidebar: create actions at the top, menu items (Files / Chats / Skills /
// Devices), and the active section below. Notion/Linear-flavored — rows on a
// soft gray canvas, hairlines, rounded corners.

import { useMemo, useRef, useState, type ElementType } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronRight,
  CirclePause,
  Copy,
  EyeOff,
  RotateCcw,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  LayoutTemplate,
  Link,
  MessageSquare,
  MoreHorizontal,
  PencilLine,
  Plus,
  Puzzle,
  SquarePen,
  Bot,
  Cable,
  SlidersHorizontal,
  Trash2,
  Zap,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useVault } from '../lib/store';
import { deletePath, movePath, putRecord, setAssistantPaused } from '../lib/sync';
import { createChat, getChatConfig, listChats, renameChat } from '../lib/chat';
import { dragState } from '../lib/dragState';
import { createFromTemplate, enabledPlugins, listTemplates, openDailyNote, usePlugin } from '../lib/plugins';
import {
  isMenuCustomized,
  moveMenuItem,
  orderedMenu,
  resetMenu,
  setMenuItemHidden,
  visibleMenu,
} from '../lib/menu';
import { getSettings, useSettings } from '../lib/settings';
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
  // Hidden namespaces stay hidden; chats live in the Chats section, not here.
  const sorted = [...records.values()]
    .filter((r) => !r.path.startsWith('.') && r.path !== 'chats' && !r.path.startsWith('chats/'))
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

// "Foo.md" -> "Foo copy.md" -> "Foo copy 2.md" (first free slot).
function uniqueCopyPath(records: Map<string, VaultRecord>, path: string): string {
  const ext = path.endsWith('.md') ? '.md' : '';
  const stem = ext ? path.slice(0, -ext.length) : path;
  for (let n = 1; ; n++) {
    const candidate = `${stem} copy${n === 1 ? '' : ` ${n}`}${ext}`;
    if (!records.has(candidate)) return candidate;
  }
}

// The component kit for a menu flavor — the same items render inside both the
// hover "…" dropdown and the right-click context menu.
interface MenuKit {
  Item: ElementType;
  Sep: ElementType;
  Sub: ElementType;
  SubTrigger: ElementType;
  SubContent: ElementType;
}

const DROPDOWN_KIT: MenuKit = {
  Item: DropdownMenuItem,
  Sep: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

const CONTEXT_KIT: MenuKit = {
  Item: ContextMenuItem,
  Sep: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

function Node({ node, depth, dialogs }: { node: TreeNode; depth: number; dialogs: DialogApi }) {
  const activePath = useVault((s) => s.activePath);
  const openFile = useVault((s) => s.openFile);
  const records = useVault((s) => s.records);
  const [open, setOpen] = useState(depth < 1);
  const [dropTarget, setDropTarget] = useState(false);

  const active = activePath === node.path;
  const displayName = node.name.replace(/\.md$/, '');
  const parentDir = node.path.split('/').slice(0, -1).join('/');

  const onClick = () => {
    if (node.type === 'folder') setOpen(!open);
    else openFile(node.path, getSettings(records).defaultMode);
  };

  const IconComp = node.type === 'folder' ? (open ? FolderOpen : Folder) : FileText;

  /* actions shared by the hover "…" dropdown and the right-click menu */

  const askNewNoteInside = () =>
    dialogs.ask({
      title: 'New note',
      placeholder: 'Note name',
      onSubmit: async (name) => {
        const path = `${node.path}/${name.replace(/\.md$/, '')}.md`;
        await putRecord(path, 'file', `# ${name}\n`);
        openFile(path, 'edit');
        setOpen(true);
      },
    });

  const askNewFolderInside = () =>
    dialogs.ask({
      title: 'New folder',
      placeholder: 'Folder name',
      onSubmit: async (name) => {
        await putRecord(`${node.path}/${name}`, 'folder');
        setOpen(true);
      },
    });

  const askRename = () =>
    dialogs.ask({
      title: `Rename ${node.type === 'folder' ? 'folder' : 'note'}`,
      initial: displayName,
      action: 'Rename',
      onSubmit: async (name) => {
        const next = name.replace(/\.md$/, '') + (node.type === 'file' ? '.md' : '');
        if (next === node.name) return;
        await movePath(node.path, parentDir ? `${parentDir}/${next}` : next);
      },
    });

  const moveTo = (dest: string) => movePath(node.path, dest ? `${dest}/${node.name}` : node.name);

  const duplicate = async () => {
    const dest = uniqueCopyPath(records, node.path);
    if (node.type === 'file') {
      await putRecord(dest, 'file', records.get(node.path)?.content ?? '');
      return;
    }
    await putRecord(dest, 'folder');
    for (const rec of records.values()) {
      if (!rec.path.startsWith(node.path + '/')) continue;
      await putRecord(dest + rec.path.slice(node.path.length), rec.type, rec.content);
    }
  };

  const copyLink = () => navigator.clipboard?.writeText(`[[${displayName}]]`);

  const confirmDelete = () =>
    dialogs.confirm({
      title: `Delete ${displayName}?`,
      description: node.type === 'folder' ? 'Everything inside this folder will be deleted.' : undefined,
      onConfirm: () => deletePath(node.path),
    });

  // Folders this node could move into — everything except itself, its own
  // subtree, and where it already lives.
  const moveTargets = [...records.values()]
    .filter(
      (r) =>
        r.type === 'folder' &&
        !r.path.startsWith('.') &&
        r.path !== 'chats' &&
        !r.path.startsWith('chats/') &&
        r.path !== node.path &&
        !r.path.startsWith(node.path + '/') &&
        r.path !== parentDir
    )
    .map((r) => r.path)
    .sort();

  const templatesOn = enabledPlugins(records).has('templates');
  const templates = templatesOn ? listTemplates(records) : [];

  const askNewFromTemplate = (templatePath: string) =>
    dialogs.ask({
      title: 'New note from template',
      placeholder: 'Note name',
      onSubmit: async (name) => {
        const path = await createFromTemplate(records, templatePath, node.path, name);
        openFile(path, 'edit');
        setOpen(true);
      },
    });

  const menuItems = ({ Item, Sep, Sub, SubTrigger, SubContent }: MenuKit) => (
    <>
      {node.type === 'folder' && (
        <>
          <Item onClick={askNewNoteInside}>
            <Plus /> New note inside
          </Item>
          <Item onClick={askNewFolderInside}>
            <FolderPlus /> New folder inside
          </Item>
          {templatesOn && (
            <Sub>
              <SubTrigger>
                <LayoutTemplate className="mr-2 size-4 text-muted-foreground" /> New from template
              </SubTrigger>
              <SubContent className="max-h-64 w-52 overflow-y-auto">
                {templates.map((t) => (
                  <Item key={t.path} onClick={() => askNewFromTemplate(t.path)}>
                    <FileText /> <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  </Item>
                ))}
                {!templates.length && <Item disabled>Add notes under templates/</Item>}
              </SubContent>
            </Sub>
          )}
          <Sep />
        </>
      )}
      <Item onClick={askRename}>
        <PencilLine /> Rename
      </Item>
      <Sub>
        <SubTrigger>
          <FolderInput className="mr-2 size-4 text-muted-foreground" /> Move to
        </SubTrigger>
        <SubContent className="max-h-64 w-48 overflow-y-auto">
          {parentDir && (
            <Item onClick={() => moveTo('')}>
              <Folder /> Vault root
            </Item>
          )}
          {moveTargets.map((path) => (
            <Item key={path} onClick={() => moveTo(path)}>
              <Folder /> <span className="min-w-0 flex-1 truncate">{path}</span>
            </Item>
          ))}
          {!moveTargets.length && !parentDir && <Item disabled>No other folders</Item>}
        </SubContent>
      </Sub>
      <Item onClick={duplicate}>
        <Copy /> Duplicate
      </Item>
      {node.type === 'file' && (
        <Item onClick={copyLink}>
          <Link /> Copy link
        </Item>
      )}
      <Sep />
      <Item variant="destructive" onClick={confirmDelete}>
        <Trash2 /> Delete
      </Item>
    </>
  );

  /* drag & drop — folders accept anything that isn't themselves, their own
     parent's no-op, or one of their descendants */

  const acceptsDrop = () =>
    node.type === 'folder' &&
    dragState.path !== null &&
    dragState.path !== node.path &&
    !node.path.startsWith(dragState.path + '/') &&
    dragState.path.split('/').slice(0, -1).join('/') !== node.path;

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              'tree-row group flex h-7 cursor-pointer items-center gap-1.5 rounded-lg pr-1 text-[13px] text-neutral-600 transition-colors select-none',
              'hover:bg-neutral-200/55 hover:text-neutral-900',
              active && 'bg-white text-neutral-900 shadow-xs',
              dropTarget && 'bg-neutral-200/80 text-neutral-900 ring-1 ring-neutral-400/60 ring-inset'
            )}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={onClick}
            draggable
            onDragStart={(e) => {
              dragState.path = node.path;
              e.dataTransfer.setData('text/plain', node.path);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => {
              dragState.path = null;
            }}
            onDragOver={(e) => {
              if (!acceptsDrop()) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              setDropTarget(true);
            }}
            onDragLeave={() => setDropTarget(false)}
            onDrop={async (e) => {
              setDropTarget(false);
              if (!acceptsDrop()) return;
              e.preventDefault();
              e.stopPropagation();
              const src = dragState.path!;
              dragState.path = null;
              setOpen(true);
              await movePath(src, `${node.path}/${src.split('/').pop()}`);
            }}
          >
            {node.type === 'folder' ? (
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
                <DropdownMenuContent align="start" className="w-48">
                  {menuItems(DROPDOWN_KIT)}
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">{menuItems(CONTEXT_KIT)}</ContextMenuContent>
      </ContextMenu>
      {node.type === 'folder' && open && (
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
    <div
      className="tree flex min-h-full flex-col gap-px pb-4"
      // Dropping on empty space (below the rows) moves the item to the root.
      onDragOver={(e) => {
        if (dragState.path && dragState.path.includes('/')) e.preventDefault();
      }}
      onDrop={async (e) => {
        if (!dragState.path || !dragState.path.includes('/')) return;
        e.preventDefault();
        const src = dragState.path;
        dragState.path = null;
        await movePath(src, src.split('/').pop()!);
      }}
    >
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

function ChatsSection({ dialogs }: { dialogs: DialogApi }) {
  const records = useVault((s) => s.records);
  const activeChat = useVault((s) => s.activeChat);
  const setActiveChat = useVault((s) => s.setActiveChat);
  const chats = useMemo(() => listChats(records), [records]);

  return (
    <div className="panel-list flex flex-col gap-px">
      {chats.map((c) => (
        <ContextMenu key={c.path}>
          <ContextMenuTrigger asChild>
            <div
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
          </ContextMenuTrigger>
          <ContextMenuContent className="w-44">
            <ContextMenuItem onClick={() => setActiveChat(c.path)}>
              <MessageSquare /> Open
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() =>
                dialogs.ask({
                  title: 'Rename chat',
                  placeholder: 'Chat title',
                  initial: c.title,
                  action: 'Save',
                  onSubmit: (title) => renameChat(records, c.path, title),
                })
              }
            >
              <PencilLine /> Rename
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onClick={() =>
                dialogs.confirm({
                  title: `Delete "${c.title}"?`,
                  description: 'The whole conversation will be deleted.',
                  onConfirm: async () => {
                    if (activeChat === c.path) setActiveChat(null);
                    await deletePath(c.path);
                  },
                })
              }
            >
              <Trash2 /> Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
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

// Right-click on a sidebar menu item: reorder, hide, reset. Preferences live
// in the synced settings record (see lib/menu.ts).
function NavItemMenu({ id, children }: { id: string; children: React.ReactNode }) {
  const settings = useSettings();
  const ordered = orderedMenu(settings);
  const idx = ordered.findIndex((m) => m.id === id);
  const visibleCount = visibleMenu(settings).length;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem disabled={idx <= 0} onClick={() => moveMenuItem(id, -1)}>
          <ArrowUp /> Move up
        </ContextMenuItem>
        <ContextMenuItem disabled={idx === ordered.length - 1} onClick={() => moveMenuItem(id, 1)}>
          <ArrowDown /> Move down
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={visibleCount <= 1} onClick={() => setMenuItemHidden(id, true)}>
          <EyeOff /> Hide from sidebar
        </ContextMenuItem>
        <ContextMenuItem disabled={!isMenuCustomized(settings)} onClick={() => resetMenu()}>
          <RotateCcw /> Reset menu
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

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
    closeTimer.current = setTimeout(() => setOpen(false), 220);
  };

  return (
    // modal={false} keeps pointer events alive on the rest of the page while
    // the menu is open — with the default modal behavior, opening the menu
    // fires a synthetic mouseleave on the trigger, which starts the close
    // timer, which closes and re-opens the menu in a loop (the flicker).
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          title="Customize"
          className={className(
            mainView === 'skills' || mainView === 'connectors' || mainView === 'automations' || mainView === 'plugins'
          )}
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
        // Returning focus to the trigger on close re-triggers hover state and
        // makes the row flash; skip it.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuItem onClick={() => setMainView('skills')}>
          <Zap /> Skills
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setMainView('plugins')}>
          <Puzzle /> Plugins
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setMainView('automations')}>
          <Bot /> Automations
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
  const pendingWrites = useVault((s) => s.pendingWrites);
  const presence = useVault((s) => s.presence);
  const openFile = useVault((s) => s.openFile);
  const setActiveChat = useVault((s) => s.setActiveChat);
  const records = useVault((s) => s.records);

  const [namePrompt, setNamePrompt] = useState<NamePrompt | null>(null);
  const [confirmPrompt, setConfirmPrompt] = useState<ConfirmPrompt | null>(null);
  const dialogs: DialogApi = { ask: setNamePrompt, confirm: setConfirmPrompt };
  const dailyNotesOn = usePlugin('daily-notes');
  const settings = useSettings();

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
          title={
            connected
              ? 'Synced'
              : pendingWrites
                ? `Offline — ${pendingWrites} change${pendingWrites === 1 ? '' : 's'} waiting to sync`
                : 'Offline'
          }
        />
        {!connected && pendingWrites > 0 && (
          <span className="pending-count font-mono text-[10px] text-neutral-400">{pendingWrites}</span>
        )}
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
        {dailyNotesOn && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="daily-note"
                title="Today's note"
                onClick={() => openDailyNote(records)}
              >
                <CalendarDays className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Today's note</TooltipContent>
          </Tooltip>
        )}
        <SettingsDialog />
      </div>

      {/* menu items — order/visibility are user preferences (right-click, or
          Settings → Appearance) so plugin-added entries stay manageable */}
      <nav className="mb-2 flex flex-col gap-px">
        {visibleMenu(settings).map((item) => {
          const navCls = (active: boolean) =>
            cn(
              'nav-item group flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 text-[13px] font-medium text-neutral-600 transition-colors select-none',
              'hover:bg-neutral-200/55 hover:text-neutral-900',
              active && 'bg-white text-neutral-900 shadow-xs'
            );
          if (item.id === 'customize')
            return (
              <NavItemMenu key={item.id} id={item.id}>
                <div className="contents">
                  <CustomizeItem className={navCls} />
                </div>
              </NavItemMenu>
            );
          return (
          <NavItemMenu key={item.id} id={item.id}>
          <button
            title={item.label}
            className={navCls(item.id === 'graph' ? mainView === 'graph' : railTab === item.id)}
            onClick={() => {
              if (item.id === 'graph') {
                setMainView('graph');
                return;
              }
              setRailTab(item.id as 'files' | 'chats' | 'devices');
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
          </NavItemMenu>
          );
        })}
      </nav>

      <div className="mx-1 mb-2 h-px bg-neutral-200/70" />

      {/* active section */}
      <div className="quiet-scroll -mx-1 flex-1 overflow-y-auto px-1">
        {railTab === 'files' && <FilesSection dialogs={dialogs} />}
        {railTab === 'chats' && <ChatsSection dialogs={dialogs} />}
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
