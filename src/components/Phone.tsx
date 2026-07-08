// The phone surface: conversational + voice only. Same vault, same chats,
// same continuity — a genuinely separate device whose presence changes what
// the assistant can do everywhere.

import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Mic, Volume2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useVault } from '../lib/store';
import { chatMessages, getChatConfig } from '../lib/chat';
import { onTurnDone, sendTurn } from '../lib/sync';
import { notificationsEnabled, notificationsSupported, setNotificationsEnabled } from '../lib/notifications';
import { voice } from '../lib/voice';
import { Chat } from './Chat';

export function Phone() {
  const connected = useVault((s) => s.connected);
  const activeChat = useVault((s) => s.activeChat);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(true);
  const [interim, setInterim] = useState('');
  const [notifs, setNotifs] = useState(notificationsEnabled());
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
    <div className="phone flex h-full flex-col bg-background">
      <header
        className="flex items-center gap-2 border-b bg-white/80 px-4 pb-2.5 backdrop-blur-xl"
        style={{ paddingTop: 'calc(10px + env(safe-area-inset-top))' }}
      >
        <span className="text-sm font-semibold tracking-tight">Vault</span>
        <span className={cn('size-1.5 rounded-full', connected ? 'bg-neutral-800' : 'bg-neutral-300')} />
        <span className="flex-1" />
        {notificationsSupported() && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="notif-toggle"
            title={notifs ? 'Reminders will notify this phone — tap to turn off' : 'Turn on reminder notifications'}
            onClick={async () => setNotifs(await setNotificationsEnabled(!notifs))}
          >
            {notifs ? <Bell className="size-4 text-neutral-700" /> : <BellOff className="size-4 text-neutral-400" />}
          </Button>
        )}
        <label className="voice-toggle flex items-center gap-1.5 text-xs text-neutral-500">
          <Volume2 className="size-3.5" />
          <Switch checked={speak} onCheckedChange={setSpeak} title="Speak replies aloud" />
        </label>
      </header>

      <Chat compact />

      <div
        className="phone-voice flex flex-col gap-1.5 border-t px-3 pt-2"
        style={{ paddingBottom: 'calc(10px + env(safe-area-inset-bottom))' }}
      >
        {interim && <div className="interim px-1 font-mono text-xs text-neutral-400">{interim}</div>}
        <Button
          variant={listening ? 'destructive' : 'secondary'}
          className={cn('mic h-11 rounded-xl text-sm font-medium', listening && 'animate-pulse')}
          onClick={toggleMic}
          disabled={!voice.available || !activeChat}
          title={voice.available ? 'Tap to speak' : 'Speech recognition unavailable in this browser'}
        >
          <Mic className="size-4" />
          {listening ? 'Listening — tap to stop' : 'Speak'}
        </Button>
      </div>
    </div>
  );
}
