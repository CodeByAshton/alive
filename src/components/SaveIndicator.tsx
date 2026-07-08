// Save feedback for debounced editors (notes, skills, memory): typing shows
// "Saving…", the write landing shows "Saved ✓" for a beat, then it gets out
// of the way. Pair useSaveFeedback() with <SaveIndicator/>.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SaveState = 'idle' | 'saving' | 'saved';

export function useSaveFeedback(): { state: SaveState; saving: () => void; saved: () => void } {
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const saving = useCallback(() => {
    clearTimeout(timer.current);
    setState('saving');
  }, []);

  const saved = useCallback(() => {
    setState('saved');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1600);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);
  return { state, saving, saved };
}

export function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  return (
    <span className={cn('save-indicator', state === 'saved' && 'saved')} data-testid="save-indicator">
      {state === 'saved' && <Check className="size-3" />}
      {state === 'saving' ? 'Saving…' : 'Saved'}
    </span>
  );
}
