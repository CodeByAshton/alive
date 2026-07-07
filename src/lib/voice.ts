// VoiceEngine — Web Speech API as the fast path, behind an interface so it
// can be swapped for Deepgram / a realtime API without touching the UI.

export interface VoiceEngine {
  available: boolean;
  listen(onResult: (text: string, isFinal: boolean) => void, onEnd: () => void): () => void;
  speak(text: string): void;
  stopSpeaking(): void;
}

export function createWebSpeechEngine(): VoiceEngine {
  const SpeechRecognition =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  return {
    available: Boolean(SpeechRecognition) || 'speechSynthesis' in window,

    listen(onResult, onEnd) {
      if (!SpeechRecognition) {
        onEnd();
        return () => {};
      }
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = navigator.language || 'en-US';
      rec.onresult = (event: any) => {
        let text = '';
        let isFinal = false;
        for (const result of event.results) {
          text += result[0].transcript;
          if (result.isFinal) isFinal = true;
        }
        onResult(text, isFinal);
      };
      rec.onend = onEnd;
      rec.onerror = onEnd;
      rec.start();
      return () => rec.stop();
    },

    speak(text) {
      if (!('speechSynthesis' in window)) return;
      speechSynthesis.cancel();
      // Strip markdown-ish noise before speaking.
      const spoken = text
        .replace(/\[\[([^\]]+)\]\]/g, '$1')
        .replace(/[*_`#>]/g, '')
        .slice(0, 1200);
      speechSynthesis.speak(new SpeechSynthesisUtterance(spoken));
    },

    stopSpeaking() {
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    },
  };
}

export const voice = createWebSpeechEngine();
