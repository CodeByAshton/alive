// The note pane. Opens in a Notion-style reading view (rendered Markdown,
// frontmatter as quiet properties); Edit switches to CodeMirror. Saves are
// debounced write-through: cache first, then cloud, live everywhere.

import { useEffect, useMemo, useRef } from 'react';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { ChevronRight, FileText } from 'lucide-react';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { parseFrontmatter } from '../../shared/frontmatter.mjs';
import { useVault } from '../lib/store';
import { putRecord } from '../lib/sync';
import { Markdown } from './Markdown';
import { Properties } from './Properties';

export function Editor() {
  const activePath = useVault((s) => s.activePath);
  const record = useVault((s) => (s.activePath ? s.records.get(s.activePath) : undefined));
  const mode = useVault((s) => s.editorMode);
  const setMode = useVault((s) => s.setEditorMode);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const lastLocalEdit = useRef<{ path: string; content: string } | null>(null);

  useEffect(() => {
    if (!hostRef.current || mode !== 'edit' || !activePath) return;

    const save = (content: string) => {
      lastLocalEdit.current = { path: activePath, content };
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => putRecord(activePath, 'file', content), 400);
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

  if (!activePath) {
    return (
      <div className="editor flex flex-1 flex-col items-center justify-center gap-2 text-neutral-400">
        <FileText className="size-6" strokeWidth={1.5} />
        <p className="text-sm">Select a note, or create one.</p>
      </div>
    );
  }

  const crumbs = activePath.replace(/\.md$/, '').split('/');

  return (
    <div className="editor flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-4">
        <nav className="flex min-w-0 flex-1 items-center gap-1 text-[13px]">
          {crumbs.map((part, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="size-3 shrink-0 text-neutral-300" />}
              <span className={i === crumbs.length - 1 ? 'truncate font-medium text-neutral-900' : 'truncate text-neutral-400'}>
                {part}
              </span>
            </span>
          ))}
        </nav>
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'read' | 'edit')}>
          <TabsList className="editor-modes">
            <TabsTrigger value="read">Read</TabsTrigger>
            <TabsTrigger value="edit">Edit</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      {mode === 'edit' ? (
        <div className="editor-cm quiet-scroll flex-1 overflow-auto" ref={hostRef} />
      ) : (
        <div className="editor-preview quiet-scroll flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[72ch] px-8 py-8 pb-[35vh]">
            {record && <Properties key={record.path} record={record} />}
            <Markdown text={parsed.body} />
          </div>
        </div>
      )}
    </div>
  );
}
