// Markdown editor pane: CodeMirror for editing, react-markdown for preview.
// Saves are debounced write-through: cache first, then cloud, live everywhere.

import { useEffect, useRef, useState } from 'react';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { useVault } from '../lib/store';
import { putRecord } from '../lib/sync';
import { Markdown } from './Markdown';

export function Editor() {
  const activePath = useVault((s) => s.activePath);
  const record = useVault((s) => (s.activePath ? s.records.get(s.activePath) : undefined));
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
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
    // Recreate the editor when switching files or modes; remote edits to the
    // open file are applied below without recreating.
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

  if (!activePath) {
    return (
      <div className="editor empty">
        <p>Select a note, or create one.</p>
      </div>
    );
  }

  return (
    <div className="editor">
      <div className="editor-header">
        <span className="mono editor-path">{activePath}</span>
        <div className="editor-modes">
          <button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>
            Edit
          </button>
          <button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>
            Preview
          </button>
        </div>
      </div>
      {mode === 'edit' ? (
        <div className="editor-cm" ref={hostRef} />
      ) : (
        <div className="editor-preview">
          <Markdown text={record?.content ?? ''} />
        </div>
      )}
    </div>
  );
}
