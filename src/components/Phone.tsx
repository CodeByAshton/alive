// The phone surface: conversational + voice only. Same vault, same chats,
// same continuity — a genuinely separate device whose presence changes what
// the assistant can do everywhere.

import { useEffect, useRef, useState } from 'react';
import { useVault } from '../lib/store';
import { chatMessages, getChatConfig } from '../lib/chat';
import { onTurnDone, sendTurn } from '../lib/sync';
import { voice } from '../lib/voice';
import { Chat } from './Chat';

export function Phone() {
  const connected = useVault((s) => s.connected);
  const activeChat = useVault((s) => s.activeChat);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(true);
  const [interim, setInterim] = useState('');
  const stopRef = useRef<(() => void) | null>(null);

  // Voice-initiated, screen-confirmed: spoken input becomes a normal turn;
  // the assistant narrates back over TTS while edits land on the desktop.
  useEffect(() => {
    return onTurnDone((chatPath) => {
      if (!speak || chatPath !== useVault.getState().activeChat) return;
      const records = useVault.getState().records;
      const messages = chatMessages(records, chatPath);
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant') voice.speak(last.body);
    });
  }, [speak]);

  const toggleMic = () => {
    if (listening) {
      stopRef.current?.();
      return;
    }
    voice.stopSpeaking();
    setListening(true);
    stopRef.current = voice.listen(
      (text, isFinal) => {
        setInterim(text);
        if (isFinal) {
          setInterim('');
          const state = useVault.getState();
          const chat = state.activeChat;
          if (chat && text.trim()) {
            const config = getChatConfig(state.records, chat);
            sendTurn(chat, text.trim(), config.provider, config.model);
          }
        }
      },
      () => setListening(false)
    );
  };

  return (
    <div className="phone">
      <div className="phone-header">
        <span className="app-title">Vault</span>
        <span className={`conn-dot ${connected ? 'on' : 'off'}`} />
        <button className={`voice-toggle mono ${speak ? 'on' : ''}`} onClick={() => setSpeak(!speak)} title="Speak replies aloud">
          voice {speak ? 'on' : 'off'}
        </button>
      </div>
      <Chat compact />
      <div className="phone-voice">
        {interim && <div className="interim mono">{interim}</div>}
        <button
          className={`mic ${listening ? 'listening' : ''}`}
          onClick={toggleMic}
          disabled={!voice.available || !activeChat}
          title={voice.available ? 'Hold a thought, tap to speak' : 'Speech recognition unavailable in this browser'}
        >
          {listening ? '● listening — tap to stop' : 'speak'}
        </button>
      </div>
    </div>
  );
}
