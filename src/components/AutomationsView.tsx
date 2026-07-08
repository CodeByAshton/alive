// Full-screen automations manager (Customize → Automations): list on the
// left, detail on the right. An automation is a Markdown file under
// .vault/automations/ that a non-model scheduler runs — the user never edits
// the script by hand. The "Edit automation" button opens a prompt window:
// describe the change in plain language and one model call rewrites the file.
// The Memory pane shows what the assistant has learned (a plain, editable note).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Brain, Clock, Pencil, Play, Plus, Sparkles, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useVault } from '../lib/store';
import {
  approveProposal,
  humanSchedule,
  listAutomations,
  MEMORY_FILE,
  setAutomationEnabled,
  timeAgoShort,
  type Automation,
} from '../lib/automations';
import { deletePath, dismissAutomationProposal, editAutomation, putRecord, requestReflection, runAutomationNow } from '../lib/sync';
import { ConfirmDialog, type ConfirmPrompt } from './dialogs';

function defaultEngine(providers: { id: string; available: boolean; models: string[] }[]) {
  const p = providers.find((x) => x.available && x.models.length);
  return p ? { provider: p.id, model: p.models[0] } : { provider: 'anthropic', model: 'claude-opus-4-8' };
}

export function AutomationsView() {
  const records = useVault((s) => s.records);
  const automations = useMemo(() => listAutomations(records), [records]);
  const [selected, setSelected] = useState<string | null>(null); // path, or 'memory'
  const [promptFor, setPromptFor] = useState<{ path: string | null } | null>(null);
  const [confirmPrompt, setConfirmPrompt] = useState<ConfirmPrompt | null>(null);

  useEffect(() => {
    if (!selected && automations.length) setSelected(automations[0].path);
    if (selected && selected !== 'memory' && !automations.some((a) => a.path === selected)) {
      setSelected(automations[0]?.path ?? 'memory');
    }
  }, [automations, selected]);

  const current = automations.find((a) => a.path === selected) ?? null;

  return (
    <div className="automations-view flex min-h-0 flex-1">
      <div className="flex w-72 shrink-0 flex-col border-r">
        <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <span className="text-[13px] font-semibold">Automations</span>
          <Button size="xs" onClick={() => setPromptFor({ path: null })}>
            <Plus className="size-3.5" /> New automation
          </Button>
        </header>
        <div className="quiet-scroll flex-1 overflow-y-auto p-2">
          {automations.map((a) => (
            <button
              key={a.path}
              className={cn(
                'flex w-full cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors',
                selected === a.path ? 'bg-neutral-100' : 'hover:bg-neutral-50'
              )}
              onClick={() => setSelected(a.path)}
            >
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border bg-white">
                {a.status === 'proposed' ? (
                  <Sparkles className="size-3.5 text-neutral-500" />
                ) : (
                  <Bot className="size-3.5 text-neutral-500" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-neutral-900">{a.name}</span>
                  {a.status === 'proposed' && (
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                      Suggested
                    </Badge>
                  )}
                  {a.status !== 'proposed' && !a.enabled && (
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px] text-neutral-400">
                      Off
                    </Badge>
                  )}
                </span>
                <span className="block truncate text-[11.5px] text-neutral-400">{humanSchedule(a.schedule)}</span>
              </span>
            </button>
          ))}
          {!automations.length && (
            <div className="px-3 py-6 text-center text-xs text-neutral-400">
              No automations yet — describe one and it runs on schedule with no AI involved. Try “remind me to
              stretch every day at 15:00”.
            </div>
          )}
        </div>
        <div className="border-t p-2">
          <button
            className={cn(
              'flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors',
              selected === 'memory' ? 'bg-neutral-100' : 'hover:bg-neutral-50'
            )}
            onClick={() => setSelected('memory')}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-lg border bg-white">
              <Brain className="size-3.5 text-neutral-500" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-neutral-900">Memory</span>
              <span className="block truncate text-[11.5px] text-neutral-400">What the assistant has learned</span>
            </span>
          </button>
        </div>
      </div>

      {selected === 'memory' ? (
        <MemoryPane />
      ) : current ? (
        <AutomationDetail
          key={current.path}
          automation={current}
          onEdit={() => setPromptFor({ path: current.path })}
          onDelete={() =>
            setConfirmPrompt({
              title: `Delete ${current.name}?`,
              description: 'It will stop running. This can’t be undone.',
              onConfirm: () => deletePath(current.path),
            })
          }
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-neutral-400">
          <Bot className="size-6" strokeWidth={1.5} />
          <p className="text-sm">Select an automation, or create one.</p>
        </div>
      )}

      <AutomationPromptDialog
        request={promptFor}
        automation={promptFor?.path ? (automations.find((a) => a.path === promptFor.path) ?? null) : null}
        onClose={() => setPromptFor(null)}
        onSaved={(path) => setSelected(path)}
      />
      <ConfirmDialog prompt={confirmPrompt} onClose={() => setConfirmPrompt(null)} />
    </div>
  );
}

function AutomationDetail({
  automation: a,
  onEdit,
  onDelete,
}: {
  automation: Automation;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showScript, setShowScript] = useState(false);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
        <span className="truncate text-[13px] font-medium text-neutral-900">{a.name}</span>
        <span className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" title="Run now" onClick={() => runAutomationNow(a.path)}>
            <Play className="size-4 text-neutral-400" />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Delete automation" onClick={onDelete}>
            <Trash2 className="size-4 text-neutral-400" />
          </Button>
        </span>
      </header>
      <div className="quiet-scroll flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-5 px-8 py-8">
          {a.status === 'proposed' && (
            <div className="flex flex-col gap-2.5 rounded-2xl border bg-neutral-50 p-4">
              <div className="flex items-center gap-2 text-[12.5px] font-medium text-neutral-800">
                <Sparkles className="size-4 text-neutral-500" />
                The assistant noticed a pattern and suggests this automation.
              </div>
              <p className="text-[12px] leading-relaxed text-neutral-500">
                Nothing runs until you approve it. Approving turns it on with the schedule below.
              </p>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={() => approveProposal(a)}>
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    dismissAutomationProposal(a.name);
                    deletePath(a.path);
                  }}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          {/* What it does, in the automation's own plain language. */}
          <p className="text-[13.5px] leading-relaxed text-neutral-700">{a.about || a.description}</p>

          <div className="flex flex-col divide-y rounded-2xl border bg-white">
            <div className="flex items-center gap-3 px-4 py-3">
              <Clock className="size-4 shrink-0 text-neutral-400" />
              <span className="flex-1 text-[13px] text-neutral-700">{humanSchedule(a.schedule)}</span>
              <span className="font-mono text-[11px] text-neutral-400">{a.schedule}</span>
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="flex-1 text-[13px] text-neutral-700">
                {a.status === 'proposed' ? 'Waiting for your approval' : a.enabled ? 'On' : 'Off'}
              </span>
              <Switch
                checked={a.enabled && a.status !== 'proposed'}
                disabled={a.status === 'proposed'}
                onCheckedChange={(on) => setAutomationEnabled(a, on)}
                aria-label="Enable automation"
              />
            </div>
            <div className="flex items-center gap-3 px-4 py-3 text-[12px] text-neutral-500">
              {a.lastRun ? (
                <>
                  <span className="flex-1">Last ran {timeAgoShort(a.lastRun)}</span>
                  <span className={cn('font-mono text-[11px]', a.lastResult?.startsWith('error') ? 'text-red-500' : 'text-neutral-400')}>
                    {a.lastResult ?? ''}
                  </span>
                </>
              ) : (
                <span className="flex-1">Hasn’t run yet</span>
              )}
            </div>
          </div>

          <Button onClick={onEdit} className="w-fit">
            <Pencil className="size-3.5" /> Edit automation
          </Button>

          <div>
            <button
              className="cursor-pointer text-[11.5px] font-medium tracking-wide text-neutral-400 uppercase hover:text-neutral-600"
              onClick={() => setShowScript(!showScript)}
            >
              {showScript ? 'Hide script' : 'Show script'}
            </button>
            {showScript && (
              <pre className="mt-2 overflow-x-auto rounded-xl border bg-neutral-50 px-3.5 py-3 font-mono text-[12px] leading-relaxed whitespace-pre text-neutral-700">
                {a.script || '(empty)'}
              </pre>
            )}
            <p className="mt-2 text-[11.5px] leading-relaxed text-neutral-400">
              This script runs on the server on schedule — no AI involved. To change what it does, use Edit
              automation and describe the change in plain language.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// The prompt window: plain-language in, rewritten automation file out.
function AutomationPromptDialog({
  request,
  automation,
  onClose,
  onSaved,
}: {
  request: { path: string | null } | null;
  automation: Automation | null;
  onClose: () => void;
  onSaved: (path: string) => void;
}) {
  const providers = useVault((s) => s.providers);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInstruction('');
    setError(null);
    setBusy(false);
  }, [request]);

  const submit = async () => {
    if (!instruction.trim() || busy || !request) return;
    setBusy(true);
    setError(null);
    const { provider, model } = defaultEngine(providers);
    try {
      const path = await editAutomation(request.path, instruction.trim(), provider, model);
      onSaved(path);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="automation-prompt-dialog">
        <DialogHeader>
          <DialogTitle>{automation ? `Edit “${automation.name}”` : 'New automation'}</DialogTitle>
          <DialogDescription>
            {automation
              ? 'Describe what should change — the schedule, the message, what it does.'
              : 'Describe what it should do and when, like you’d tell a person. It becomes a scheduled script that runs without AI.'}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          value={instruction}
          rows={3}
          placeholder={
            automation ? 'e.g. move it to 8pm and mention drinking water too' : 'e.g. remind me to take my meds every day at 9:00'
          }
          className="resize-none"
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {error && <p className="text-[12px] text-red-500">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!instruction.trim() || busy}>
            {busy ? 'Writing…' : automation ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Memory: the durable half of learning — a visible, editable note the
// assistant reads every turn and appends to via save_memory and reflection.
function MemoryPane() {
  const record = useVault((s) => s.records.get(MEMORY_FILE));
  const [draft, setDraft] = useState(record?.content ?? '');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSaved = useRef(record?.content ?? '');
  const [reflecting, setReflecting] = useState(false);

  useEffect(() => {
    const incoming = record?.content ?? '';
    if (incoming !== lastSaved.current) {
      setDraft(incoming);
      lastSaved.current = incoming;
    }
  }, [record]);

  const update = (value: string) => {
    setDraft(value);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      lastSaved.current = value;
      putRecord(MEMORY_FILE, 'file', value);
    }, 600);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
        <span className="text-[13px] font-medium text-neutral-900">Memory</span>
        <Button
          size="xs"
          variant="outline"
          disabled={reflecting}
          onClick={() => {
            setReflecting(true);
            requestReflection();
            setTimeout(() => setReflecting(false), 4000);
          }}
        >
          <Brain className="size-3.5" /> {reflecting ? 'Reflecting…' : 'Reflect now'}
        </Button>
      </header>
      <div className="quiet-scroll flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-4 px-8 py-8">
          <p className="text-[12.5px] leading-relaxed text-neutral-500">
            Everything the assistant has learned about you lives here as plain text, loaded into every
            conversation. It adds to this when you tell it something worth keeping, and a daily reflection pass
            mines recent chats for patterns — repeated asks become suggested automations. Edit or delete anything.
          </p>
          <Textarea
            value={draft}
            rows={18}
            placeholder="Nothing learned yet. Chat with the assistant, or press Reflect now."
            className="leading-relaxed"
            onChange={(e) => update(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
