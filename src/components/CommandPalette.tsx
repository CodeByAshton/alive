// Cmd-K command palette: search every note (title first, then content) and
// every chat, hit Enter, and it opens full-screen. Linear-flavored.

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, MessageSquare, Search } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useVault } from '../lib/store';
import { listChats } from '../lib/chat';

interface Hit {
  path: string;
  title: string;
  detail: string;
  kind: 'note' | 'chat';
  score: number;
}

const MAX_RESULTS = 12;

function search(records: Map<string, import('../lib/types').VaultRecord>, query: string): Hit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: Hit[] = [];

  for (const rec of records.values()) {
    if (rec.type !== 'file' || rec.path.startsWith('.') || rec.path.startsWith('chats/')) continue;
    const title = rec.path.split('/').pop()!.replace(/\.md$/, '');
    const titleIdx = title.toLowerCase().indexOf(q);
    if (titleIdx !== -1) {
      hits.push({ path: rec.path, title, detail: rec.path, kind: 'note', score: titleIdx === 0 ? 0 : 1 });
      continue;
    }
    const contentIdx = rec.content.toLowerCase().indexOf(q);
    if (contentIdx !== -1) {
      const start = Math.max(0, contentIdx - 24);
      const snippet = rec.content.slice(start, contentIdx + q.length + 40).replace(/\n+/g, ' ').trim();
      hits.push({ path: rec.path, title, detail: `…${snippet}…`, kind: 'note', score: 2 });
    }
  }

  for (const chat of listChats(records)) {
    if (chat.title.toLowerCase().includes(q)) {
      hits.push({ path: chat.path, title: chat.title, detail: 'chat', kind: 'chat', score: 1 });
    }
  }

  return hits.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title)).slice(0, MAX_RESULTS);
}

export function CommandPalette() {
  const records = useVault((s) => s.records);
  const openFile = useVault((s) => s.openFile);
  const setActiveChat = useVault((s) => s.setActiveChat);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => search(records, query), [records, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  const pick = (hit: Hit) => {
    setOpen(false);
    if (hit.kind === 'chat') setActiveChat(hit.path);
    else openFile(hit.path, 'read');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="command-palette top-[30%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogTitle className="sr-only">Search the vault</DialogTitle>
        <div className="flex items-center gap-2.5 border-b px-4">
          <Search className="size-4 shrink-0 text-neutral-400" />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search notes and chats…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-neutral-400"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelected((s) => Math.min(s + 1, hits.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelected((s) => Math.max(s - 1, 0));
              } else if (e.key === 'Enter' && hits[selected]) {
                e.preventDefault();
                pick(hits[selected]);
              }
            }}
          />
          <kbd className="rounded-md border bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400">esc</kbd>
        </div>
        <div className="quiet-scroll max-h-80 overflow-y-auto p-1.5">
          {hits.map((hit, i) => (
            <button
              key={`${hit.kind}:${hit.path}`}
              className={cn(
                'palette-hit flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left',
                i === selected ? 'bg-neutral-100' : 'hover:bg-neutral-50'
              )}
              onMouseEnter={() => setSelected(i)}
              onClick={() => pick(hit)}
            >
              {hit.kind === 'chat' ? (
                <MessageSquare className="size-4 shrink-0 text-neutral-400" />
              ) : (
                <FileText className="size-4 shrink-0 text-neutral-400" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-neutral-800">{hit.title}</span>
                <span className="block truncate text-[11px] text-neutral-400">{hit.detail}</span>
              </span>
            </button>
          ))}
          {query.trim() && !hits.length && (
            <div className="px-3 py-6 text-center text-xs text-neutral-400">No matches for “{query.trim()}”.</div>
          )}
          {!query.trim() && (
            <div className="px-3 py-6 text-center text-xs text-neutral-400">Type to search every note and chat.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
