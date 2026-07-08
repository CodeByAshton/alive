// The note area. Each NotePane opens in a Notion-style reading view
// (rendered Markdown, frontmatter as quiet properties, clickable task
// checkboxes); Edit switches to a live-preview CodeMirror where markdown
// styles itself as you type. Drag a tab (or a file from the tree) onto the
// right half to open it in a second pane. Saves are debounced write-through:
// cache first, then cloud, live everywhere.

import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { FileText, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { parseFrontmatter } from '../../shared/frontmatter.mjs';
import { dragState } from '../lib/dragState';
import { extractOutline, findBacklinks, usePlugin, wordStats } from '../lib/plugins';
import { getSettings } from '../lib/settings';
import { useVault } from '../lib/store';
import { putRecord } from '../lib/sync';
import { basename } from '../lib/wikilinks';
import { Markdown } from './Markdown';
import { Properties } from './Properties';
import { SaveIndicator, useSaveFeedback } from './SaveIndicator';

/* ── live preview: markdown styles itself while you type ─────────────── */

const livePreviewHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.7em', fontWeight: '700', lineHeight: '1.3' },
  { tag: t.heading2, fontSize: '1.35em', fontWeight: '650', lineHeight: '1.3' },
  { tag: t.heading3, fontSize: '1.15em', fontWeight: '600' },
  { tag: t.heading4, fontWeight: '600' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.9em' },
  { tag: t.link, color: 'var(--accent-color)' },
  { tag: t.url, color: 'var(--color-neutral-400)' },
  { tag: t.quote, color: 'var(--color-neutral-500)', fontStyle: 'italic' },
  // the syntax itself (#, *, >, [ ]) stays quiet
  { tag: t.processingInstruction, color: 'var(--color-neutral-400)', fontWeight: '400' },
  { tag: t.meta, color: 'var(--color-neutral-400)' },
  { tag: t.contentSeparator, color: 'var(--color-neutral-300)' },
]);

/* ── in-app tabs ──────────────────────────────────────────────────────── */

// Every note opened this session, switchable in place. Tabs are draggable —
// drop one on the right half of the editor to open it in a split pane.
function TabStrip() {
  const openTabs = useVault((s) => s.openTabs);
  const records = useVault((s) => s.records);
  const activePath = useVault((s) => s.activePath);
  const openFile = useVault((s) => s.openFile);
  const closeTab = useVault((s) => s.closeTab);

  // Deleted/moved files fall out of the strip on their own.
  const tabs = openTabs.filter((p) => records.has(p));

  return (
    <nav className="editor-tabs quiet-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      {tabs.map((path) => {
        const active = path === activePath;
        return (
          <div
            key={path}
            role="tab"
            aria-selected={active}
            title={path}
            draggable
            onDragStart={(e) => {
              dragState.path = path;
              e.dataTransfer.setData('text/plain', path);
              e.dataTransfer.effectAllowed = 'copyMove';
            }}
            onDragEnd={() => {
              dragState.path = null;
            }}
            className={cn(
              'editor-tab group flex h-8 max-w-44 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] transition-colors select-none',
              active
                ? 'border-border bg-neutral-100/80 font-medium text-neutral-900'
                : 'border-transparent text-neutral-500 hover:bg-neutral-100/60 hover:text-neutral-800'
            )}
            onClick={() => openFile(path, 'read')}
          >
            <FileText className="size-3.5 shrink-0 text-neutral-400" />
            <span className="min-w-0 truncate">{basename(path)}</span>
            <button
              title="Close tab"
              className={cn(
                'grid size-4 shrink-0 cursor-pointer place-items-center rounded text-neutral-400 transition-opacity hover:bg-neutral-200 hover:text-neutral-700',
                active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              )}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(path);
              }}
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </nav>
  );
}

/* ── plugin panels ────────────────────────────────────────────────────── */

// Backlinks plugin: linked mentions of the open note, under the body.
function BacklinksPanel({ path }: { path: string }) {
  const records = useVault((s) => s.records);
  const openFile = useVault((s) => s.openFile);
  const links = useMemo(() => findBacklinks(records, path), [records, path]);

  return (
    <div className="backlinks mt-14 border-t pt-5">
      <div className="mb-2.5 text-[10.5px] font-medium tracking-wide text-neutral-400 uppercase">
        Linked mentions{links.length > 0 && ` · ${links.length}`}
      </div>
      <div className="flex flex-col gap-1">
        {links.map((l) => (
          <button
            key={l.path}
            className="backlink -mx-2 flex cursor-pointer flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-neutral-50"
            onClick={() => openFile(l.path, getSettings(records).defaultMode)}
          >
            <span className="text-[13px] font-medium text-neutral-800">{l.title}</span>
            {l.snippet && <span className="truncate text-[12px] text-neutral-400">{l.snippet}</span>}
          </button>
        ))}
        {!links.length && <p className="text-[12px] text-neutral-400">No notes link here yet.</p>}
      </div>
    </div>
  );
}

// Outline plugin: heading table of contents beside the reading view.
function OutlinePanel({ body, previewRef }: { body: string; previewRef: React.RefObject<HTMLDivElement | null> }) {
  const headings = useMemo(() => extractOutline(body), [body]);
  if (headings.length < 2) return null;

  const jump = (text: string) => {
    const container = previewRef.current;
    if (!container) return;
    const els = [...container.querySelectorAll('h1, h2, h3')];
    const hit =
      els.find((el) => (el.textContent ?? '').trim() === text) ??
      els.find((el) => (el.textContent ?? '').trim().startsWith(text.slice(0, 24)));
    hit?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <aside className="outline-panel quiet-scroll hidden w-52 shrink-0 overflow-y-auto border-l px-3 py-5 xl:block">
      <div className="mb-2 px-2 text-[10.5px] font-medium tracking-wide text-neutral-400 uppercase">Outline</div>
      {headings.map((h, i) => (
        <button
          key={i}
          className="block w-full cursor-pointer truncate rounded-md py-1 pr-2 text-left text-[12px] text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
          style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
          title={h.text}
          onClick={() => jump(h.text)}
        >
          {h.text}
        </button>
      ))}
    </aside>
  );
}

/* ── one pane = header + read/edit body for a single note ─────────────── */

// Split a leading "# Title" line (ignoring blank lines before it) off the
// body so the reading view can slot the properties directly beneath it.
function splitLeadingHeading(body: string): { heading: string | null; rest: string } {
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i < lines.length && /^#\s+\S/.test(lines[i])) {
    return { heading: lines[i], rest: lines.slice(i + 1).join('\n') };
  }
  return { heading: null, rest: body };
}

const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/gm;

interface NotePaneProps {
  path: string;
  mode: 'read' | 'edit';
  setMode: (mode: 'read' | 'edit') => void;
  headerLeft: React.ReactNode;
  onClose: () => void;
  closeTitle: string;
  secondary?: boolean;
}

function NotePane({ path, mode, setMode, headerLeft, onClose, closeTitle, secondary }: NotePaneProps) {
  const record = useVault((s) => s.records.get(path));
  const hostRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastLocalEdit = useRef<{ path: string; content: string } | null>(null);
  const feedback = useSaveFeedback();

  useEffect(() => {
    if (!hostRef.current || mode !== 'edit') return;

    const save = (content: string) => {
      lastLocalEdit.current = { path, content };
      feedback.saving();
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        await putRecord(path, 'file', content);
        feedback.saved();
      }, 400);
    };

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: record?.content ?? '',
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(livePreviewHighlight),
          placeholder('Write…'),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) save(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [path, mode]);

  // Apply remote changes to the open document (avoid clobbering local typing).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !record || record.path !== path) return;
    const current = view.state.doc.toString();
    if (record.content === current) return;
    if (lastLocalEdit.current?.path === path && lastLocalEdit.current.content === current) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: record.content } });
  }, [record?.content, record?.mtime]);

  const parsed = useMemo(
    () => (record ? parseFrontmatter(record.content) : { data: {}, body: '' }),
    [record?.content]
  );

  // Reading view order: title first, properties under it, then the body —
  // so a leading H1 is split off and rendered above the metadata.
  const { heading, rest } = useMemo(() => splitLeadingHeading(parsed.body), [parsed.body]);

  const backlinksOn = usePlugin('backlinks');
  const outlineOn = usePlugin('outline');
  const wordCountOn = usePlugin('word-count');
  const stats = useMemo(() => wordStats(parsed.body), [parsed.body]);

  // Clicking the nth task checkbox in the reading view flips the nth task
  // marker in the source file. `rest` holds every checkbox the view renders
  // (frontmatter and the title line can't contain task items), so ordinals
  // line up with the full content.
  const toggleTask = (index: number, checked: boolean) => {
    if (!record || index < 0) return;
    let i = 0;
    const next = record.content.replace(TASK_RE, (m, pre, _state, post) =>
      i++ === index ? `${pre}${checked ? 'x' : ' '}${post}` : m
    );
    if (next !== record.content) {
      lastLocalEdit.current = { path, content: next };
      putRecord(path, 'file', next);
    }
  };

  return (
    <div className={cn('note-pane flex min-h-0 min-w-0 flex-1 flex-col', secondary && 'split-pane border-l')}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        {headerLeft}
        {wordCountOn && (
          <span className="word-count hidden shrink-0 text-[11px] whitespace-nowrap text-neutral-400 md:inline">
            {stats.words.toLocaleString()} words · {stats.minutes} min
          </span>
        )}
        <SaveIndicator state={feedback.state} />
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'read' | 'edit')}>
          <TabsList className="editor-modes">
            <TabsTrigger value="read">Read</TabsTrigger>
            <TabsTrigger value="edit">Edit</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="ghost" size="icon-sm" className="editor-close ml-1" title={closeTitle} onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>

      {mode === 'edit' ? (
        <div className="editor-cm quiet-scroll flex-1 overflow-auto" ref={hostRef} />
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1">
          <div className="editor-preview quiet-scroll min-w-0 flex-1 overflow-y-auto" ref={previewRef}>
            <div className="mx-auto w-full px-8 py-8 pb-[35vh]" style={{ maxWidth: 'var(--content-width, 72ch)' }}>
              {heading && (
                <div className="note-title mb-4">
                  <Markdown text={heading} />
                </div>
              )}
              {record && <Properties key={record.path} record={record} />}
              <Markdown text={rest} onTaskToggle={toggleTask} />
              {backlinksOn && <BacklinksPanel path={path} />}
            </div>
          </div>
          {outlineOn && !secondary && <OutlinePanel body={parsed.body} previewRef={previewRef} />}
        </div>
      )}
    </div>
  );
}

/* ── the editor area: main pane + optional split ──────────────────────── */

export function Editor() {
  const activePath = useVault((s) => s.activePath);
  const records = useVault((s) => s.records);
  const splitPath = useVault((s) => s.splitPath);
  const setSplitPath = useVault((s) => s.setSplitPath);
  const mode = useVault((s) => s.editorMode);
  const setMode = useVault((s) => s.setEditorMode);
  const setMainView = useVault((s) => s.setMainView);
  const [splitMode, setSplitMode] = useState<'read' | 'edit'>('read');
  const [dropHint, setDropHint] = useState(false);

  // A deleted/moved note closes its split pane.
  useEffect(() => {
    if (splitPath && !records.has(splitPath)) setSplitPath(null);
  }, [splitPath, records, setSplitPath]);

  // Clear the drop hint even when the drag is cancelled mid-air.
  useEffect(() => {
    const clear = () => setDropHint(false);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);

  if (!activePath) {
    return (
      <div className="editor flex flex-1 flex-col items-center justify-center gap-2 text-neutral-400">
        <FileText className="size-6" strokeWidth={1.5} />
        <p className="text-sm">Select a note, or create one.</p>
      </div>
    );
  }

  const overRightHalf = (e: React.DragEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX > r.left + r.width * 0.55;
  };

  return (
    <div
      className="editor relative flex min-h-0 min-w-0 flex-1"
      onDragOver={(e) => {
        if (!dragState.path?.endsWith('.md')) return;
        if (overRightHalf(e)) {
          e.preventDefault();
          // 'move' is within every source's effectAllowed (tree rows use
          // 'move', tabs 'copyMove') — a mismatch makes the browser refuse
          // the drop entirely.
          e.dataTransfer.dropEffect = 'move';
          setDropHint(true);
        } else {
          setDropHint(false);
        }
      }}
      onDrop={(e) => {
        const path = dragState.path;
        setDropHint(false);
        if (!path?.endsWith('.md') || !overRightHalf(e)) return;
        e.preventDefault();
        dragState.path = null;
        setSplitPath(path);
      }}
    >
      <NotePane
        path={activePath}
        mode={mode}
        setMode={setMode}
        headerLeft={<TabStrip />}
        onClose={() => setMainView('chat')}
        closeTitle="Back to chat"
      />
      {splitPath && records.has(splitPath) && (
        <NotePane
          path={splitPath}
          mode={splitMode}
          setMode={setSplitMode}
          secondary
          headerLeft={
            <span className="flex min-w-0 flex-1 items-center gap-1.5 pl-1 text-[12.5px] font-medium text-neutral-900">
              <FileText className="size-3.5 shrink-0 text-neutral-400" />
              <span className="truncate">{basename(splitPath)}</span>
            </span>
          }
          onClose={() => setSplitPath(null)}
          closeTitle="Close split"
        />
      )}
      {dropHint && (
        <div className="split-hint pointer-events-none absolute inset-y-2 right-2 z-20 w-[44%] rounded-xl border-2 border-dashed border-neutral-400 bg-neutral-500/10" />
      )}
    </div>
  );
}
