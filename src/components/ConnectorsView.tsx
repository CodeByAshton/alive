// Full-screen connectors manager: plug external MCP servers into the
// assistant. When a connector is enabled and reachable, its tools join the
// assistant's toolset on every turn.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Cable, CircleAlert, CircleCheck, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useVault } from '../lib/store';
import {
  fetchConnectorStatus,
  listConnectors,
  newConnectorPath,
  saveConnector,
  type Connector,
  type ConnectorStatus,
} from '../lib/connectors';
import { deletePath } from '../lib/sync';
import { ConfirmDialog, type ConfirmPrompt } from './dialogs';

export function ConnectorsView() {
  const records = useVault((s) => s.records);
  const connectors = useMemo(() => listConnectors(records), [records]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [status, setStatus] = useState<Map<string, ConnectorStatus>>(new Map());
  const [checking, setChecking] = useState(false);
  const [confirmPrompt, setConfirmPrompt] = useState<ConfirmPrompt | null>(null);

  useEffect(() => {
    if (!selectedPath && connectors.length) setSelectedPath(connectors[0].path);
    if (selectedPath && !connectors.some((c) => c.path === selectedPath)) setSelectedPath(connectors[0]?.path ?? null);
  }, [connectors, selectedPath]);

  const refresh = async () => {
    setChecking(true);
    try {
      const list = await fetchConnectorStatus();
      setStatus(new Map(list.map((s) => [s.path, s])));
    } catch {
      /* server unreachable; leave as-is */
    }
    setChecking(false);
  };

  useEffect(() => {
    refresh();
  }, [connectors.length]);

  const selected = connectors.find((c) => c.path === selectedPath) ?? null;

  const createConnector = async () => {
    const path = newConnectorPath(records);
    await saveConnector({ path, name: 'New connector', url: '', token: '', enabled: true });
    setSelectedPath(path);
  };

  return (
    <div className="connectors-view flex min-h-0 flex-1">
      <div className="flex w-72 shrink-0 flex-col border-r">
        <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <span className="text-[13px] font-semibold">Connectors</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" title="Re-check connectors" onClick={refresh}>
              <RefreshCw className={cn('size-3.5', checking && 'animate-spin')} />
            </Button>
            <Button size="xs" onClick={createConnector}>
              <Plus className="size-3.5" /> New
            </Button>
          </div>
        </header>
        <div className="quiet-scroll flex-1 overflow-y-auto p-2">
          {connectors.map((c) => {
            const s = status.get(c.path);
            return (
              <button
                key={c.path}
                className={cn(
                  'flex w-full cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors',
                  selectedPath === c.path ? 'bg-neutral-100' : 'hover:bg-neutral-50'
                )}
                onClick={() => setSelectedPath(c.path)}
              >
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border bg-white">
                  <Cable className="size-3.5 text-neutral-500" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-neutral-900">
                    <span className="truncate">{c.name}</span>
                    {!c.enabled ? null : s?.ok ? (
                      <CircleCheck className="size-3 shrink-0 text-neutral-500" />
                    ) : s?.error ? (
                      <CircleAlert className="size-3 shrink-0 text-destructive/70" />
                    ) : null}
                  </span>
                  <span className="block truncate text-[11.5px] text-neutral-400">
                    {c.enabled ? (s?.ok ? `${s.tools.length} tool${s.tools.length === 1 ? '' : 's'}` : (s?.error ? 'unreachable' : '…')) : 'off'}
                    {c.url ? ` · ${c.url.replace(/^https?:\/\//, '')}` : ''}
                  </span>
                </span>
              </button>
            );
          })}
          {!connectors.length && (
            <div className="px-3 py-6 text-center text-xs text-neutral-400">
              Connect external services (MCP servers) and their tools become available to the assistant.
            </div>
          )}
        </div>
        <p className="border-t px-4 py-3 text-[11px] leading-relaxed text-neutral-400">
          A connector is an MCP server URL. While it's enabled and reachable, its tools join the
          assistant's toolset automatically.
        </p>
      </div>

      {selected ? (
        <ConnectorEditor
          key={selected.path}
          connector={selected}
          status={status.get(selected.path)}
          onSaved={refresh}
          onDelete={() =>
            setConfirmPrompt({
              title: `Remove ${selected.name}?`,
              description: 'Its tools will no longer be available to the assistant.',
              onConfirm: () => deletePath(selected.path),
            })
          }
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-neutral-400">
          <Cable className="size-6" strokeWidth={1.5} />
          <p className="text-sm">Add a connector to get started.</p>
        </div>
      )}

      <ConfirmDialog prompt={confirmPrompt} onClose={() => setConfirmPrompt(null)} />
    </div>
  );
}

function ConnectorEditor({
  connector,
  status,
  onSaved,
  onDelete,
}: {
  connector: Connector;
  status?: ConnectorStatus;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<Connector>(connector);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSaved = useRef<Connector>(connector);

  useEffect(() => {
    if (JSON.stringify(connector) !== JSON.stringify(lastSaved.current)) setDraft(connector);
  }, [connector]);

  const update = (patch: Partial<Connector>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      lastSaved.current = next;
      await saveConnector(next);
      onSaved();
    }, 600);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <span className="truncate text-[13px] font-medium text-neutral-900">{draft.name}</span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-neutral-500">
            Enabled
            <Switch checked={draft.enabled} onCheckedChange={(enabled) => update({ enabled })} />
          </label>
          <Button variant="ghost" size="icon-sm" title="Remove connector" onClick={onDelete}>
            <Trash2 className="size-4 text-neutral-400" />
          </Button>
        </div>
      </header>
      <div className="quiet-scroll flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-5 px-8 py-8">
          <Field label="Name">
            <Input value={draft.name} onChange={(e) => update({ name: e.target.value })} />
          </Field>
          <Field label="Server URL" hint="The MCP server endpoint, e.g. https://mcp.example.com/mcp">
            <Input
              value={draft.url}
              placeholder="https://…"
              className="font-mono"
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(e) => update({ url: e.target.value.trim() })}
            />
          </Field>
          <Field label="Access token" hint="Optional — sent as a Bearer token.">
            <Input
              value={draft.token}
              type="password"
              placeholder="none"
              className="font-mono"
              onChange={(e) => update({ token: e.target.value.trim() })}
            />
          </Field>

          <div className="connector-status rounded-xl border bg-neutral-50/60 px-4 py-3">
            <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-neutral-600">
              {!draft.enabled ? (
                'Turned off'
              ) : status?.ok ? (
                <>
                  <CircleCheck className="size-3.5 text-neutral-600" /> Connected
                </>
              ) : status?.error ? (
                <>
                  <CircleAlert className="size-3.5 text-destructive/70" /> Can't reach this server
                </>
              ) : (
                <>
                  <Loader2 className="size-3.5 animate-spin text-neutral-400" /> Checking…
                </>
              )}
            </div>
            {status?.ok && status.tools.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {status.tools.map((t) => (
                  <Badge key={t} variant="secondary" className="rounded-md font-mono text-[10.5px] font-normal text-neutral-600">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
            {status?.error && <p className="font-mono text-[11px] text-neutral-400">{status.error}</p>}
          </div>
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
