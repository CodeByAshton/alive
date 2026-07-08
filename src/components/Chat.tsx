// The chat pane, consumer edition: just the conversation. Messages are still
// Markdown files inside the chat folder; the technical detail (models, tool
// calls) stays in the files' frontmatter — the UI shows prose, attachments,
// and a friendly status line while the assistant works.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, FileText, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useVault } from '../lib/store';
import { chatMessages, createChat, getChatConfig, listChats } from '../lib/chat';
import { sendTurn } from '../lib/sync';
import type { StreamState } from '../lib/types';
import { Markdown } from './Markdown';
import { ModelPicker } from './ModelPicker';

const THINKING_PHRASES = [
  'Thinking…',
  'Connecting the dots…',
  'Rummaging through the vault…',
  'Pondering…',
  'Almost there…',
];

const TOOL_PHRASES: Record<string, string> = {
  create_note: 'Writing a note…',
  edit_note: 'Editing a note…',
  append_note: 'Adding to a note…',
  read_note: 'Reading your notes…',
  list_files: 'Looking through the vault…',
  create_folder: 'Tidying things up…',
  move_path: 'Tidying things up…',
  delete_path: 'Tidying things up…',
  run_command: 'Working on your computer…',
};

function StatusLine({ stream }: { stream: StreamState }) {
  const [phrase, setPhrase] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setPhrase((p) => (p + 1) % THINKING_PHRASES.length), 2600);
    return () => clearInterval(timer);
  }, []);

  const running = [...stream.tools].reverse().find((t) => t.status === 'running');
  const label = running ? (TOOL_PHRASES[running.name] ?? 'Working…') : THINKING_PHRASES[phrase];

  return (
    <div className="status-line flex items-center gap-2 py-0.5">
      <span className="shimmer-text text-[13px] font-medium">{label}</span>
    </div>
  );
}

function AttachmentCard({ path, compact }: { path: string; compact: boolean }) {
  const openFile = useVault((s) => s.openFile);
  const setRailTab = useVault((s) => s.setRailTab);
  const name = path.split('/').pop()!.replace(/\.md$/, '');
  const folder = path.split('/').slice(0, -1).join('/');

  return (
    <button
      className={cn(
        'attachment-card flex w-fit max-w-full items-center gap-2.5 rounded-xl border bg-white px-3 py-2 text-left shadow-xs transition-colors',
        !compact && 'cursor-pointer hover:bg-neutral-50'
      )}
      onClick={() => {
        if (compact) return;
        openFile(path, 'read');
        setRailTab('files');
      }}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-neutral-100">
        <FileText className="size-3.5 text-neutral-500" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-medium text-neutral-800">{name}</span>
        {folder && <span className="block truncate text-[10.5px] text-neutral-400">{folder}</span>}
      </span>
    </button>
  );
}

export function Chat({ compact = false }: { compact?: boolean }) {
  const records = useVault((s) => s.records);
  const activeChat = useVault((s) => s.activeChat);
  const setActiveChat = useVault((s) => s.setActiveChat);
  const stream = useVault((s) => (s.activeChat ? s.streams.get(s.activeChat) : undefined));
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const chats = useMemo(() => listChats(records), [records]);
  const messages = useMemo(() => (activeChat ? chatMessages(records, activeChat) : []), [records, activeChat]);

  useEffect(() => {
    if (!activeChat && chats.length) setActiveChat(chats[0].path);
  }, [activeChat, chats, setActiveChat]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, stream?.text, stream?.tools.length]);

  const submit = () => {
    const text = draft.trim();
    if (!text || !activeChat || stream?.active) return;
    const config = getChatConfig(records, activeChat);
    sendTurn(activeChat, text, config.provider, config.model);
    setDraft('');
  };

  const newChat = async () => {
    const config = activeChat ? getChatConfig(records, activeChat) : { provider: 'anthropic', model: 'claude-opus-4-8' };
    setActiveChat(await createChat(config));
  };

  return (
    <div className={cn('chat flex min-h-0 flex-1 flex-col', compact && 'compact')}>
      <header className="chat-header flex h-12 shrink-0 items-center gap-2 border-b px-3">
        {compact ? (
          <select
            className="chat-select h-8 min-w-0 flex-1 rounded-lg border bg-transparent px-2 text-[13px]"
            value={activeChat ?? ''}
            onChange={(e) => setActiveChat(e.target.value || null)}
          >
            {!activeChat && <option value="">No chat</option>}
            {chats.map((c) => (
              <option key={c.path} value={c.path}>
                {c.title}
              </option>
            ))}
          </select>
        ) : (
          <span className="chat-title min-w-0 flex-1 truncate pl-1 text-[13px] font-medium text-neutral-900">
            {chats.find((c) => c.path === activeChat)?.title ?? 'No chat selected'}
          </span>
        )}
        {activeChat && <ModelPicker chatPath={activeChat} />}
        <Button variant="ghost" size="icon-sm" title="New chat" onClick={newChat}>
          <Plus className="size-4" />
        </Button>
      </header>

      <div className="chat-scroll quiet-scroll flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4" ref={scrollRef}>
        {messages.map((m) => (
          <div
            key={m.path}
            className={cn(
              'bubble flex max-w-[86%] flex-col gap-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-200',
              m.role === 'user'
                ? 'user self-end rounded-2xl rounded-br-md bg-neutral-900 px-3.5 py-2 text-white'
                : 'assistant self-start'
            )}
          >
            {m.role === 'user' ? (
              <span className="text-[13.5px] leading-normal whitespace-pre-wrap">{m.body}</span>
            ) : (
              <>
                <Markdown text={m.body} size="sm" />
                {m.filesTouched && m.filesTouched.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.filesTouched.map((path) => (
                      <AttachmentCard key={path} path={path} compact={compact} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        {stream && (stream.active || stream.error) && (
          <div className="bubble assistant streaming flex max-w-[86%] flex-col gap-1.5 self-start">
            {stream.active && <StatusLine stream={stream} />}
            {stream.text && <Markdown text={stream.text} size="sm" />}
            {stream.error && (
              <div className="stream-error rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-[12.5px] text-neutral-500">
                Hmm, that didn't go through. Mind trying again?
                <span className="mt-0.5 block font-mono text-[10.5px] text-neutral-400">{stream.error}</span>
              </div>
            )}
          </div>
        )}

        {!messages.length && !stream?.active && (
          <div className="chat-empty m-auto text-center text-[13px] text-neutral-400">
            <p>
              Ask anything — or try{' '}
              <code className="rounded-md border bg-neutral-100 px-1.5 py-px font-mono text-xs">/summarize</code>{' '}
              <code className="rounded-md border bg-neutral-100 px-1.5 py-px font-mono text-xs">/journal</code>{' '}
              <code className="rounded-md border bg-neutral-100 px-1.5 py-px font-mono text-xs">/task</code>
            </p>
          </div>
        )}
      </div>

      <div className="composer shrink-0 px-3 pb-3">
        <div className="flex items-end gap-2 rounded-2xl border bg-white p-2 shadow-xs transition-colors focus-within:border-neutral-400">
          <Textarea
            value={draft}
            placeholder={activeChat ? 'Message…' : 'Create a chat first'}
            disabled={!activeChat}
            rows={2}
            className="min-h-0 flex-1 resize-none border-0 bg-transparent p-1.5 shadow-none focus-visible:ring-0"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Button
            className="send size-8 rounded-full"
            size="icon"
            title="Send"
            onClick={submit}
            disabled={!draft.trim() || !activeChat || stream?.active}
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
