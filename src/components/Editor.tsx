// The note pane. Opens in a Notion-style reading view (rendered Markdown,
// frontmatter as quiet properties); Edit switches to CodeMirror. Saves are
// debounced write-through: cache first, then cloud, live everywhere.

import { useEffect, useMemo, useRef } from 'react';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { FileText, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { parseFrontmatter } from '../../shared/frontmatter.mjs';
import { extractOutline, findBacklinks, usePlugin, wordStats } from '../lib/plugins';
import { useVault } from '../lib/store';
import { putRecord } from '../lib/sync';
import { basename } from '../lib/wikilinks';
import { Markdown } from './Markdown';
import { Properties } from './Properties';
import { SaveIndicator, useSaveFeedback } from './SaveIndicator';

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
            onClick={() => openFile(l.path, 'read')}
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

// In-app tabs: every note opened this session, switchable in place.
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

export function Editor() {
  const activePath = useVault((s) => s.activePath);
  const record = useVault((s) => (s.activePath ? s.records.get(s.activePath) : undefined));
  const mode = useVault((s) => s.editorMode);
  const setMode = useVault((s) => s.setEditorMode);
  const setMainView = useVault((s) => s.setMainView);
  const hostRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastLocalEdit = useRef<{ path: string; content: string } | null>(null);
  const feedback = useSaveFeedback();

  useEffect(() => {
    if (!hostRef.current || mode !== 'edit' || !activePath) return;

    const save = (content: string) => {
      lastLocalEdit.current = { path: activePath, content };
      feedback.saving();
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        await putRecord(activePath, 'file', content);
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
  }, [activePath, mode]);

  // Apply remote changes to the open document (avoid clobbering local typing).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !record || record.path !== activePath) return;
    const current = view.state.doc.toString();
    if (record.content === current) return;
    if (lastLocalEdit.current?.path === activePath && lastLocalEdit.current.content === current) return;
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

  if (!activePath) {
    return (
      <div className="editor flex flex-1 flex-col items-center justify-center gap-2 text-neutral-400">
        <FileText className="size-6" strokeWidth={1.5} />
        <p className="text-sm">Select a note, or create one.</p>
      </div>
    );
  }

  return (
    <div className="editor flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <TabStrip />
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
        <Button
          variant="ghost"
          size="icon-sm"
          className="editor-close ml-1"
          title="Back to chat"
          onClick={() => setMainView('chat')}
        >
          <X className="size-4" />
        </Button>
      </header>

      {mode === 'edit' ? (
        <div className="editor-cm quiet-scroll flex-1 overflow-auto" ref={hostRef} />
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1">
          <div className="editor-preview quiet-scroll min-w-0 flex-1 overflow-y-auto" ref={previewRef}>
            <div className="mx-auto max-w-[72ch] px-8 py-8 pb-[35vh]">
              {heading && (
                <div className="note-title mb-4">
                  <Markdown text={heading} />
                </div>
              )}
              {record && <Properties key={record.path} record={record} />}
              <Markdown text={rest} />
              {backlinksOn && <BacklinksPanel path={activePath} />}
            </div>
          </div>
          {outlineOn && <OutlinePanel body={parsed.body} previewRef={previewRef} />}
        </div>
      )}
    </div>
  );
}
