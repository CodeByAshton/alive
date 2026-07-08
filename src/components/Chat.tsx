// The chat pane, consumer edition: just the conversation. Messages are still
// Markdown files inside the chat folder; the technical detail (models, tool
// calls) stays in the files' frontmatter — the UI shows prose, attachments,
// and a friendly status line while the assistant works.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Copy, FileText, Mic, Paperclip, Plus, ShieldCheck, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useVault } from '../lib/store';
import { chatMessages, createChat, getChatConfig, listChats } from '../lib/chat';
import { listSkills } from '../lib/skills';
import { respondToApproval, sendTurn } from '../lib/sync';
import { voice } from '../lib/voice';
import type { StreamState } from '../lib/types';
import { basename } from '../lib/wikilinks';
import { Markdown } from './Markdown';
import { ModelPicker } from './ModelPicker';

// A five-bar Siri-style waveform shown while the mic is live.
export function DictationWave({ className }: { className?: string }) {
  return (
    <span className={cn('dictation-wave', className)} aria-hidden>
      <span />
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

// One entry in the composer's inline autocomplete (slash commands / [[refs]]).
interface Suggestion {
  id: string;
  label: string;
  detail: string;
  insert: string;
}

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
  save_memory: 'Remembering that…',
  save_automation: 'Setting up an automation…',
  list_automations: 'Checking your automations…',
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

// Voice-initiated, screen-confirmed: an action the assistant wants to take
// (a command on your computer, or a connector acting on an external service)
// waits here until a human on any device approves it.
function ApprovalCard({ id, command, kind }: { id: string; command: string; kind: 'command' | 'connector' | 'automation' }) {
  return (
    <div className="approval-card flex max-w-[86%] flex-col gap-2.5 self-start rounded-2xl border bg-white p-3.5 shadow-xs animate-in fade-in-0 slide-in-from-bottom-1">
      <div className="flex items-center gap-2 text-[12.5px] font-medium text-neutral-800">
        <ShieldCheck className="size-4 text-neutral-500" />
        {kind === 'connector'
          ? 'Let this connector act?'
          : kind === 'automation'
            ? 'Save this automation? It will run on schedule, unattended.'
            : 'Run this command on your computer?'}
      </div>
      <code className="block overflow-x-auto rounded-lg border bg-neutral-50 px-3 py-2 font-mono text-[12px] whitespace-pre text-neutral-700">
        {command}
      </code>
      <div className="flex gap-2">
        <Button size="sm" className="approve flex-1" onClick={() => respondToApproval(id, true)}>
          Approve
        </Button>
        <Button size="sm" variant="outline" className="deny flex-1" onClick={() => respondToApproval(id, false)}>
          Deny
        </Button>
      </div>
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
  const approvals = useVault((s) => s.approvals);
  const paused = useVault((s) => s.paused);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const stopListenRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Inline autocomplete: '/' at the start of the draft offers commands,
  // '[[' anywhere offers note references.
  const [menu, setMenu] = useState<{ kind: 'slash' | 'ref'; query: string; start: number } | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);

  const chats = useMemo(() => listChats(records), [records]);
  const messages = useMemo(() => (activeChat ? chatMessages(records, activeChat) : []), [records, activeChat]);

  // Notes usable as attachments and [[references]] — most recently edited first.
  const notes = useMemo(
    () =>
      [...records.values()]
        .filter((r) => r.type === 'file' && r.path.endsWith('.md') && !r.path.startsWith('chats/') && !r.path.startsWith('.'))
        .sort((a, b) => b.mtime - a.mtime),
    [records]
  );
  const attachable = useMemo(() => notes.slice(0, 15), [notes]);
  const skills = useMemo(() => listSkills(records).filter((s) => s.trigger.startsWith('/')), [records]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!menu) return [];
    const q = menu.query.toLowerCase();
    if (menu.kind === 'slash') {
      return skills
        .filter((s) => s.trigger.slice(1).toLowerCase().startsWith(q))
        .map((s) => ({
          id: s.path,
          label: s.trigger,
          detail: s.description || s.name,
          insert: `${s.trigger} `,
        }));
    }
    return notes
      .filter((r) => basename(r.path).toLowerCase().includes(q))
      .slice(0, 8)
      .map((r) => ({
        id: r.path,
        label: basename(r.path),
        detail: r.path.split('/').slice(0, -1).join('/'),
        insert: `[[${basename(r.path)}]] `,
      }));
  }, [menu, skills, notes]);

  useEffect(() => setMenuIndex(0), [menu?.kind, menu?.query]);

  const refreshMenu = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const slash = before.match(/^\/([\w-]*)$/);
    if (slash) return setMenu({ kind: 'slash', query: slash[1], start: 0 });
    const ref = before.match(/\[\[([^\][]*)$/);
    if (ref) return setMenu({ kind: 'ref', query: ref[1], start: caret - ref[1].length - 2 });
    setMenu(null);
  };

  const applySuggestion = (s: Suggestion) => {
    if (!menu) return;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? draft.length;
    setDraft(draft.slice(0, menu.start) + s.insert + draft.slice(caret));
    const pos = menu.start + s.insert.length;
    setMenu(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  useEffect(() => {
    if (!activeChat && chats.length) setActiveChat(chats[0].path);
  }, [activeChat, chats, setActiveChat]);

  // Messages already on screen when a chat opens must not replay their entry
  // animation — only messages that arrive afterwards animate in.
  const animateFromRef = useRef(0);
  const prevChatRef = useRef<string | null | undefined>(undefined);
  if (prevChatRef.current !== activeChat) {
    prevChatRef.current = activeChat;
    animateFromRef.current = messages.length;
  }

  // Pin to the bottom before paint so switching chats lands settled instead
  // of visibly jumping.
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [activeChat, messages.length, stream?.text, stream?.tools.length]);

  const submit = () => {
    let text = draft.trim();
    if ((!text && !attachments.length) || !activeChat || stream?.active) return;
    if (attachments.length) {
      // Attached notes ride along as [[references]] — the harness inlines
      // their contents into the turn's context.
      const refs = attachments.map((p) => `[[${basename(p)}]]`).join(' ');
      text = text ? `${text}\n\n${refs}` : refs;
    }
    const config = getChatConfig(records, activeChat);
    sendTurn(activeChat, text, config.provider, config.model);
    setDraft('');
    setAttachments([]);
    setMenu(null);
  };

  const toggleMic = () => {
    if (listening) {
      stopListenRef.current?.();
      return;
    }
    setListening(true);
    const base = draft;
    stopListenRef.current = voice.listen(
      (text, isFinal) => {
        setDraft(base ? `${base} ${text}` : text);
        if (isFinal) setListening(false);
      },
      () => setListening(false)
    );
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
        <Button variant="ghost" size="icon-sm" title="New chat" onClick={newChat}>
          <Plus className="size-4" />
        </Button>
      </header>

      <div className="chat-scroll quiet-scroll flex flex-1 overflow-y-auto px-4 pt-4 pb-2" ref={scrollRef}>
        <div className={cn('mx-auto flex min-h-full w-full flex-col gap-3 pb-6', !compact && 'max-w-3xl')}>
        {messages.map((m, i) => (
          <ContextMenu key={m.path}>
            <ContextMenuTrigger asChild>
              <div
                className={cn(
                  'bubble flex max-w-[86%] flex-col gap-2',
                  i >= animateFromRef.current && 'animate-in fade-in-0 slide-in-from-bottom-1 duration-200',
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
            </ContextMenuTrigger>
            <ContextMenuContent className="w-44">
              <ContextMenuItem onClick={() => navigator.clipboard?.writeText(m.body)}>
                <Copy /> Copy message
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}

        {approvals.map((a) => (
          <ApprovalCard key={a.id} id={a.id} command={a.command} kind={a.kind} />
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
      </div>

      <div className={cn('composer mx-auto w-full shrink-0 px-3 pt-1 pb-3', !compact && 'max-w-3xl')}>
        <div className="relative flex flex-col gap-1 rounded-2xl border bg-white p-2 shadow-xs transition-colors focus-within:border-neutral-400">
          {menu && suggestions.length > 0 && (
            <div className="composer-menu absolute inset-x-0 bottom-full z-30 mb-2 overflow-hidden rounded-xl border bg-white shadow-md animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
              <div className="quiet-scroll max-h-56 overflow-y-auto p-1">
                {suggestions.map((s, i) => (
                  <button
                    key={s.id}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors',
                      i === menuIndex ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-600'
                    )}
                    onMouseEnter={() => setMenuIndex(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applySuggestion(s);
                    }}
                  >
                    {menu.kind === 'slash' ? (
                      <span className="grid size-5 shrink-0 place-items-center rounded-md border bg-neutral-50 font-mono text-[11px] text-neutral-500">
                        /
                      </span>
                    ) : (
                      <FileText className="size-4 shrink-0 text-neutral-400" />
                    )}
                    <span className="shrink-0 font-medium">{s.label}</span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-neutral-400">{s.detail}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1 px-1 pt-0.5">
              {attachments.map((path) => (
                <Badge key={path} variant="secondary" className="gap-1.5 rounded-lg py-1 font-normal text-neutral-600">
                  <FileText className="size-3" />
                  {basename(path)}
                  <button
                    className="cursor-pointer text-neutral-400 hover:text-neutral-700"
                    onClick={() => setAttachments(attachments.filter((p) => p !== path))}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <Textarea
            ref={textareaRef}
            value={draft}
            placeholder={paused ? 'Assistant is paused — resume it from Devices' : activeChat ? 'Message… ("/" for commands, "[[" to reference a note)' : 'Create a chat first'}
            disabled={!activeChat || paused}
            rows={compact ? 1 : 2}
            className="min-h-0 flex-1 resize-none border-0 bg-transparent p-1.5 shadow-none focus-visible:ring-0"
            onChange={(e) => {
              setDraft(e.target.value);
              refreshMenu(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onBlur={() => setMenu(null)}
            onKeyDown={(e) => {
              if (menu && suggestions.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMenuIndex((i) => (i + 1) % suggestions.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMenuIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  applySuggestion(suggestions[menuIndex]);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setMenu(null);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" title="Attach a note" disabled={!activeChat}>
                  <Paperclip className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="attach-menu max-h-72 w-60 overflow-y-auto">
                <DropdownMenuLabel>Attach a note</DropdownMenuLabel>
                {attachable.map((r) => (
                  <DropdownMenuItem
                    key={r.path}
                    disabled={attachments.includes(r.path)}
                    onClick={() => setAttachments([...attachments, r.path])}
                  >
                    <FileText />
                    <span className="min-w-0 flex-1 truncate">{basename(r.path)}</span>
                  </DropdownMenuItem>
                ))}
                {!attachable.length && <DropdownMenuItem disabled>No notes yet</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
            {activeChat && <ModelPicker chatPath={activeChat} />}
            <span className="flex-1" />
            {voice.available && (
              <Button
                variant="ghost"
                size="icon-sm"
                title={listening ? 'Stop dictating' : 'Dictate'}
                className={cn('mic-button', listening && 'text-destructive')}
                disabled={!activeChat}
                onClick={toggleMic}
              >
                {listening ? <DictationWave /> : <Mic className="size-4" />}
              </Button>
            )}
            <Button
              className="send size-8 rounded-full"
              size="icon"
              title="Send"
              onClick={submit}
              disabled={(!draft.trim() && !attachments.length) || !activeChat || stream?.active}
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
