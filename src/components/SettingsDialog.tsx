// Settings — the assistant's standing instructions live here (stored at
// .vault/AGENT.md, hidden from the file tree). The assistant can read and
// update the same file itself when you ask it to change how it behaves.

import { useEffect, useState } from 'react';
import { Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useVault } from '../lib/store';
import { putRecord } from '../lib/sync';

const AGENT_PATH = '.vault/AGENT.md';

export function SettingsDialog() {
  const record = useVault((s) => s.records.get(AGENT_PATH));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (open) setDraft(record?.content ?? '');
  }, [open, record?.content]);

  const save = async () => {
    await putRecord(AGENT_PATH, 'file', draft);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" title="Settings">
          <Settings className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="settings-dialog sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Assistant instructions</DialogTitle>
          <DialogDescription>
            Standing guidance the assistant follows in every conversation. You can also just tell the
            assistant how you'd like it to behave — it updates this itself.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={draft}
          rows={14}
          className="leading-relaxed"
          placeholder="e.g. Keep answers short. New notes go under notes/. Always confirm before deleting anything."
          onChange={(e) => setDraft(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
