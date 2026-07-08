// Settings — the assistant's default mode and its standing instructions.
// Instructions live at .vault/AGENT.md (hidden from the file tree); the
// assistant can read and update the same file itself when you ask it to
// change how it behaves. The mode is a vault-wide setting shared by every
// device, Claude-style: confirm each command, run unattended, or read-only.

import { useEffect, useState } from 'react';
import { Download, LogOut, Settings } from 'lucide-react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useVault } from '../lib/store';
import { putRecord, setAssistantMode } from '../lib/sync';
import { getServerConfig } from '../lib/config';
import { authMode, authQuery, signOut } from '../lib/auth';
import type { AssistantMode } from '../lib/types';

const AGENT_PATH = '.vault/AGENT.md';

const MODES: { id: AssistantMode; label: string; hint: string }[] = [
  { id: 'ask', label: 'Ask first', hint: 'Every command waits for your approval on-screen.' },
  { id: 'auto', label: 'Auto', hint: 'Commands run without asking. Use with care.' },
  { id: 'readonly', label: 'Read-only', hint: 'The assistant never runs commands.' },
];

export function SettingsDialog() {
  const record = useVault((s) => s.records.get(AGENT_PATH));
  const mode = useVault((s) => s.mode);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (open) setDraft(record?.content ?? '');
  }, [open, record?.content]);

  const save = async () => {
    await putRecord(AGENT_PATH, 'file', draft);
    setOpen(false);
  };

  const current = MODES.find((m) => m.id === mode) ?? MODES[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" title="Settings">
          <Settings className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="settings-dialog sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            How the assistant behaves everywhere — every device shares these.
          </DialogDescription>
        </DialogHeader>

        <div className="mode-setting flex items-center justify-between gap-4 rounded-xl border bg-neutral-50/60 px-3.5 py-3">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-neutral-800">Default mode</div>
            <div className="mt-0.5 text-xs leading-relaxed text-neutral-500">{current.hint}</div>
          </div>
          <Select value={mode} onValueChange={(m) => setAssistantMode(m as AssistantMode)}>
            <SelectTrigger size="sm" className="mode-select w-32 shrink-0 bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {MODES.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="px-0.5 text-[13px] font-medium text-neutral-800">Assistant instructions</div>
          <Textarea
            value={draft}
            rows={12}
            className="leading-relaxed"
            placeholder="e.g. Keep answers short. New notes go under notes/. Always confirm before deleting anything."
            onChange={(e) => setDraft(e.target.value)}
          />
          <p className="px-0.5 text-xs text-neutral-400">
            You can also just tell the assistant how you'd like it to behave — it updates this itself.
          </p>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="export-vault text-neutral-500"
              title="Download the whole vault as a zip of Markdown files"
              onClick={async () => {
                const server = getServerConfig();
                if (server) window.open(`${server.httpBase}/api/export?${await authQuery()}`, '_blank');
              }}
            >
              <Download className="size-3.5" /> Export vault
            </Button>
            {authMode() === 'accounts' && (
              <Button
                variant="ghost"
                size="sm"
                className="sign-out text-neutral-500"
                onClick={async () => {
                  await signOut();
                  location.reload();
                }}
              >
                <LogOut className="size-3.5" /> Sign out
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
