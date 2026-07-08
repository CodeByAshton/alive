// The chat pane. Messages are Markdown files inside the chat folder; the
// in-flight assistant turn streams over the wire and is replaced by the
// persisted message record when the turn completes.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, Loader2, Plus, Wrench, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useVault } from '../lib/store';
import { chatMessages, createChat, getChatConfig, listChats } from '../lib/chat';
import { sendTurn } from '../lib/sync';
import { Markdown } from './Markdown';
import { ModelPicker } from './ModelPicker';

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
              'bubble max-w-[86%] animate-in fade-in-0 slide-in-from-bottom-1 duration-200',
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
                <div className="bubble-meta mt-1.5 flex items-center gap-2 font-mono text-[10.5px] text-neutral-400">
                  {m.model}
                  {m.toolsUsed?.length ? (
                    <span className="flex items-center gap-1">
                      <Wrench className="size-2.5" />
                      {m.toolsUsed.length} tool call{m.toolsUsed.length > 1 ? 's' : ''}
                    </span>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ))}

        {stream && (stream.active || stream.error) && (
          <div className="bubble assistant streaming max-w-[86%] self-start">
            {stream.tools.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1">
                {stream.tools.map((t, i) => (
                  <Badge key={i} variant="secondary" className="gap-1 font-mono text-[10.5px] font-normal text-neutral-500">
                    {t.status === 'running' ? (
                      <Loader2 className="size-2.5 animate-spin" />
                    ) : t.status === 'done' ? (
                      <Check className="size-2.5" />
                    ) : (
                      <X className="size-2.5" />
                    )}
                    {t.name}
                  </Badge>
                ))}
              </div>
            )}
            {stream.text && <Markdown text={stream.text} size="sm" />}
            {stream.active && !stream.text && !stream.tools.length && (
              <Loader2 className="size-4 animate-spin text-neutral-300" />
            )}
            {stream.error && <div className="stream-error mt-1 font-mono text-xs text-destructive">⚠ {stream.error}</div>}
          </div>
        )}

        {!messages.length && !stream?.active && (
          <div className="chat-empty m-auto text-center text-[13px] text-neutral-400">
            <p>
              Ask anything — or try a skill:{' '}
              <code className="rounded-md border bg-neutral-100 px-1.5 py-px font-mono text-xs">/summarize</code>{' '}
              <code className="rounded-md border bg-neutral-100 px-1.5 py-px font-mono text-xs">/journal</code>{' '}
              <code className="rounded-md border bg-neutral-100 px-1.5 py-px font-mono text-xs">/task</code>
            </p>
          </div>
        )}
      </div>

      <div className="composer shrink-0 px-3 pb-3">
        <div className="flex items-end gap-2 rounded-2xl border bg-white p-2 shadow-xs focus-within:border-neutral-400 transition-colors">
          <Textarea
            value={draft}
            placeholder={activeChat ? 'Message…  ( / for skills, [[ to reference notes )' : 'Create a chat first'}
            disabled={!activeChat}
            rows={compact ? 2 : 2}
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
