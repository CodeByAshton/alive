// Full-screen skills manager: list on the left, structured editor on the
// right. Skills are stored under .vault/skills/ — no folder in the file tree.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useVault } from '../lib/store';
import { listSkills, newSkillPath, saveSkill, type Skill } from '../lib/skills';
import { deletePath } from '../lib/sync';
import { ConfirmDialog, type ConfirmPrompt } from './dialogs';
import { SaveIndicator, useSaveFeedback } from './SaveIndicator';

export function SkillsView() {
  const records = useVault((s) => s.records);
  const skills = useMemo(() => listSkills(records), [records]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [confirmPrompt, setConfirmPrompt] = useState<ConfirmPrompt | null>(null);

  useEffect(() => {
    if (!selectedPath && skills.length) setSelectedPath(skills[0].path);
    if (selectedPath && !skills.some((s) => s.path === selectedPath)) setSelectedPath(skills[0]?.path ?? null);
  }, [skills, selectedPath]);

  const selected = skills.find((s) => s.path === selectedPath) ?? null;

  const createSkill = async () => {
    const path = newSkillPath(records);
    await saveSkill({
      path,
      name: 'New skill',
      trigger: '/new-skill',
      description: 'What this skill does.',
      instructions: 'Instructions the assistant follows when this skill is invoked. Write them like you would brief a colleague.',
    });
    setSelectedPath(path);
  };

  return (
    <div className="skills-view flex min-h-0 flex-1">
      <div className="flex w-72 shrink-0 flex-col border-r">
        <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <span className="text-[13px] font-semibold">Skills</span>
          <Button size="xs" onClick={createSkill}>
            <Plus className="size-3.5" /> New skill
          </Button>
        </header>
        <div className="quiet-scroll flex-1 overflow-y-auto p-2">
          {skills.map((s) => (
            <button
              key={s.path}
              className={cn(
                'flex w-full cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors',
                selectedPath === s.path ? 'bg-neutral-100' : 'hover:bg-neutral-50'
              )}
              onClick={() => setSelectedPath(s.path)}
            >
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-white border">
                <Zap className="size-3.5 text-neutral-500" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-neutral-900">{s.name}</span>
                <span className="block truncate text-[11.5px] text-neutral-400">
                  <span className="font-mono">{s.trigger}</span> · {s.description}
                </span>
              </span>
            </button>
          ))}
          {!skills.length && (
            <div className="px-3 py-6 text-center text-xs text-neutral-400">
              No skills yet — create one and invoke it in chat with its slash command.
            </div>
          )}
        </div>
        <p className="border-t px-4 py-3 text-[11px] leading-relaxed text-neutral-400">
          Type a skill's slash command in chat (like <span className="font-mono">/summarize</span>) and its
          instructions guide that reply.
        </p>
      </div>

      {selected ? (
        <SkillEditor
          key={selected.path}
          skill={selected}
          onDelete={() =>
            setConfirmPrompt({
              title: `Delete ${selected.name}?`,
              description: 'The slash command will stop working.',
              onConfirm: () => deletePath(selected.path),
            })
          }
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-neutral-400">
          <Zap className="size-6" strokeWidth={1.5} />
          <p className="text-sm">Select a skill, or create one.</p>
        </div>
      )}

      <ConfirmDialog prompt={confirmPrompt} onClose={() => setConfirmPrompt(null)} />
    </div>
  );
}

function SkillEditor({ skill, onDelete }: { skill: Skill; onDelete: () => void }) {
  const [draft, setDraft] = useState<Skill>(skill);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSaved = useRef<Skill>(skill);
  const feedback = useSaveFeedback();

  // Pick up remote edits unless we have unsaved local changes in flight.
  useEffect(() => {
    if (JSON.stringify(skill) !== JSON.stringify(lastSaved.current)) setDraft(skill);
  }, [skill]);

  const update = (patch: Partial<Skill>) => {
    const next = { ...draft, ...patch };
    if (patch.trigger !== undefined) {
      next.trigger = '/' + patch.trigger.replace(/^\/+/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    }
    setDraft(next);
    feedback.saving();
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      lastSaved.current = next;
      await saveSkill(next);
      feedback.saved();
    }, 500);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
        <span className="truncate text-[13px] font-medium text-neutral-900">{draft.name}</span>
        <span className="flex items-center gap-2">
          <SaveIndicator state={feedback.state} />
          <Button variant="ghost" size="icon-sm" title="Delete skill" onClick={onDelete}>
            <Trash2 className="size-4 text-neutral-400" />
          </Button>
        </span>
      </header>
      <div className="quiet-scroll flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-5 px-8 py-8">
          <Field label="Name">
            <Input value={draft.name} onChange={(e) => update({ name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Slash command">
              <Input
                value={draft.trigger}
                className="font-mono"
                onChange={(e) => update({ trigger: e.target.value })}
              />
            </Field>
            <Field label="Description">
              <Input value={draft.description} onChange={(e) => update({ description: e.target.value })} />
            </Field>
          </div>
          <Field label="Instructions" hint="What the assistant should do when this skill is invoked.">
            <Textarea
              value={draft.instructions}
              rows={12}
              className="skill-instructions leading-relaxed"
              onChange={(e) => update({ instructions: e.target.value })}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium tracking-wide text-neutral-400 uppercase">{label}</span>
      {children}
      {hint && <span className="text-[11.5px] text-neutral-400">{hint}</span>}
    </label>
  );
}
