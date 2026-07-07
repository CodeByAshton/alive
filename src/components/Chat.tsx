// The chat pane. Messages are Markdown files inside the chat folder; the
// in-flight assistant turn streams over the wire and is replaced by the
// persisted message record when the turn completes.

import { useEffect, useMemo, useRef, useState } from 'react';
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
  const messages = useMemo(
    () => (activeChat ? chatMessages(records, activeChat) : []),
    [records, activeChat]
  );

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
    <div className={`chat ${compact ? 'compact' : ''}`}>
      <div className="chat-header">
        {compact ? (
          <select
            className="chat-select"
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
          <span className="chat-title">
            {chats.find((c) => c.path === activeChat)?.title ?? 'No chat selected'}
          </span>
        )}
        <button onClick={newChat}>+ New</button>
        {activeChat && <ModelPicker chatPath={activeChat} />}
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.map((m) => (
          <div key={m.path} className={`bubble ${m.role}`}>
            <Markdown text={m.body} />
            {m.role === 'assistant' && (
              <div className="bubble-meta mono">
                {m.model}
                {m.toolsUsed?.length ? ` · ${m.toolsUsed.length} tool call${m.toolsUsed.length > 1 ? 's' : ''}` : ''}
              </div>
            )}
          </div>
        ))}

        {stream && (stream.active || stream.error) && (
          <div className="bubble assistant streaming">
            {stream.tools.map((t, i) => (
              <div key={i} className={`tool-chip mono ${t.status}`}>
                {t.status === 'running' ? '⟳' : t.status === 'done' ? '✓' : '✗'} {t.name}
              </div>
            ))}
            {stream.text && <Markdown text={stream.text} />}
            {stream.active && !stream.text && !stream.tools.length && <span className="thinking">…</span>}
            {stream.error && <div className="stream-error">⚠ {stream.error}</div>}
          </div>
        )}

        {!messages.length && !stream?.active && (
          <div className="chat-empty">
            <p>Ask anything. Try a skill: <span className="mono">/summarize</span>, <span className="mono">/journal</span>, <span className="mono">/task</span></p>
          </div>
        )}
      </div>

      <div className="composer">
        <textarea
          value={draft}
          placeholder={activeChat ? 'Message… ( / for skills )' : 'Create a chat first'}
          disabled={!activeChat}
          rows={compact ? 2 : 3}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button className="send" onClick={submit} disabled={!draft.trim() || !activeChat || stream?.active}>
          Send
        </button>
      </div>
    </div>
  );
}
