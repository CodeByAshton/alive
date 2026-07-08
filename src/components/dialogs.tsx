// App-level dialogs built on the shadcn Dialog primitive — replace native
// prompt()/confirm() everywhere.

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export interface NamePrompt {
  title: string;
  description?: string;
  placeholder?: string;
  initial?: string;
  action?: string;
  onSubmit: (value: string) => void | Promise<void>;
}

export function NameDialog({ prompt, onClose }: { prompt: NamePrompt | null; onClose: () => void }) {
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue(prompt?.initial ?? '');
  }, [prompt]);

  const submit = async () => {
    if (!value.trim() || !prompt) return;
    await prompt.onSubmit(value.trim());
    onClose();
  };

  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm" data-testid="name-dialog">
        <DialogHeader>
          <DialogTitle>{prompt?.title}</DialogTitle>
          {prompt?.description && <DialogDescription>{prompt.description}</DialogDescription>}
        </DialogHeader>
        <Input
          autoFocus
          value={value}
          placeholder={prompt?.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!value.trim()}>
            {prompt?.action ?? 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface ConfirmPrompt {
  title: string;
  description?: string;
  action?: string;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({ prompt, onClose }: { prompt: ConfirmPrompt | null; onClose: () => void }) {
  const confirm = async () => {
    if (!prompt) return;
    await prompt.onConfirm();
    onClose();
  };

  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm" data-testid="confirm-dialog">
        <DialogHeader>
          <DialogTitle>{prompt?.title}</DialogTitle>
          {prompt?.description && <DialogDescription>{prompt.description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm}>
            {prompt?.action ?? 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
