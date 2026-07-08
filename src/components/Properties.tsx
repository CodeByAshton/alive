// Notion-style property fields backed by YAML frontmatter (Obsidian-style).
// Rendered above the note body in the reading view; every edit rewrites the
// frontmatter block and syncs like any other vault change.

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, Hash, List, Plus, Trash2, Type, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { parseFrontmatter, serializeFrontmatter } from '../../shared/frontmatter.mjs';
import { putRecord } from '../lib/sync';
import type { VaultRecord } from '../lib/types';

type Value = string | number | boolean | null | Array<string | number | boolean | null>;

interface Row {
  id: number;
  key: string;
  value: Value;
}

function kindOf(value: Value): 'text' | 'number' | 'checkbox' | 'list' {
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  return 'text';
}

const KIND_ICON = { text: Type, number: Hash, checkbox: CheckSquare, list: List } as const;

let rowId = 0;

export function Properties({ record }: { record: VaultRecord }) {
  const [rows, setRows] = useState<Row[]>([]);
  const lastSaved = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const newKeyRef = useRef<HTMLInputElement | null>(null);
  const [focusNew, setFocusNew] = useState(false);

  const body = useMemo(() => parseFrontmatter(record.content).body, [record.content]);

  // Rebuild rows from the record unless the change is our own echo.
  useEffect(() => {
    if (record.content === lastSaved.current) return;
    const { data } = parseFrontmatter(record.content);
    setRows(Object.entries(data).map(([key, value]) => ({ id: ++rowId, key, value: value as Value })));
  }, [record.path, record.content]);

  useEffect(() => {
    if (focusNew && newKeyRef.current) {
      newKeyRef.current.focus();
      setFocusNew(false);
    }
  }, [focusNew, rows.length]);

  const save = (nextRows: Row[]) => {
    setRows(nextRows);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const data: Record<string, Value> = {};
      for (const row of nextRows) {
        if (row.key.trim()) data[row.key.trim()] = row.value;
      }
      const content = Object.keys(data).length ? serializeFrontmatter(data, body) : body;
      lastSaved.current = content;
      putRecord(record.path, 'file', content);
    }, 500);
  };

  const update = (id: number, patch: Partial<Row>) => save(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: number) => save(rows.filter((r) => r.id !== id));

  const convert = (row: Row, kind: 'text' | 'number' | 'checkbox' | 'list') => {
    let value: Value = row.value;
    if (kind === 'text') value = Array.isArray(value) ? value.join(', ') : value === null ? '' : String(value);
    else if (kind === 'number') value = Number(Array.isArray(value) ? value[0] : value) || 0;
    else if (kind === 'checkbox') value = value === true || value === 'true' || value === 1;
    else if (kind === 'list')
      value = Array.isArray(value) ? value : String(value ?? '').trim() ? String(value).split(/,\s*/) : [];
    update(row.id, { value });
  };

  const addRow = () => {
    save([...rows, { id: ++rowId, key: '', value: '' }]);
    setFocusNew(true);
  };

  return (
    <div className="properties mb-7 flex flex-col gap-px" data-testid="properties">
      {rows.map((row, i) => {
        const kind = kindOf(row.value);
        const KindIcon = KIND_ICON[kind];
        return (
          <div key={row.id} className="group flex min-h-8 items-center gap-1 rounded-lg px-1 -mx-1 hover:bg-neutral-50 transition-colors">
            <div className="flex w-36 shrink-0 items-center gap-0.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="size-6 text-neutral-400" title="Property options">
                    <KindIcon className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40">
                  <DropdownMenuLabel>Type</DropdownMenuLabel>
                  {(['text', 'number', 'checkbox', 'list'] as const).map((k) => {
                    const Icon = KIND_ICON[k];
                    return (
                      <DropdownMenuItem key={k} onClick={() => convert(row, k)} className={cn(kind === k && 'bg-accent')}>
                        <Icon /> {k === 'list' ? 'List' : k[0].toUpperCase() + k.slice(1)}
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => remove(row.id)}>
                    <Trash2 /> Remove property
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <input
                ref={i === rows.length - 1 ? newKeyRef : undefined}
                value={row.key}
                placeholder="name"
                className="w-full min-w-0 bg-transparent text-[12.5px] text-neutral-400 outline-none placeholder:text-neutral-300 focus:text-neutral-600"
                onChange={(e) => update(row.id, { key: e.target.value })}
              />
            </div>

            <div className="flex min-w-0 flex-1 items-center">
              {kind === 'checkbox' ? (
                <Switch checked={row.value === true} onCheckedChange={(checked) => update(row.id, { value: checked })} />
              ) : kind === 'list' ? (
                <TagsEditor
                  value={(row.value as Value[]).map((v) => String(v ?? ''))}
                  onChange={(tags) => update(row.id, { value: tags })}
                />
              ) : (
                <input
                  value={row.value === null ? '' : String(row.value)}
                  placeholder="Empty"
                  className="w-full bg-transparent text-[13px] text-neutral-800 outline-none placeholder:text-neutral-300"
                  onChange={(e) => {
                    const raw = e.target.value;
                    update(row.id, {
                      value: kind === 'number' && raw.trim() !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw,
                    });
                  }}
                />
              )}
            </div>

            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6 text-neutral-300 opacity-0 group-hover:opacity-100 hover:text-neutral-600"
              title="Remove property"
              onClick={() => remove(row.id)}
            >
              <X className="size-3" />
            </Button>
          </div>
        );
      })}

      <button
        className="add-property mt-0.5 flex h-7 w-fit cursor-pointer items-center gap-1.5 rounded-lg px-1.5 text-xs text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
        onClick={addRow}
      >
        <Plus className="size-3.5" /> Add property
      </button>
    </div>
  );
}

function TagsEditor({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const tag = draft.trim().replace(/,$/, '');
    if (tag) onChange([...value, tag]);
    setDraft('');
  };

  return (
    <div className="flex min-h-7 flex-1 flex-wrap items-center gap-1">
      {value.map((tag, i) => (
        <Badge key={i} variant="secondary" className="gap-1 rounded-md font-normal text-neutral-600">
          {tag}
          <button
            className="cursor-pointer text-neutral-400 hover:text-neutral-700"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X className="size-2.5" />
          </button>
        </Badge>
      ))}
      <input
        value={draft}
        placeholder={value.length ? '' : 'Empty'}
        className="min-w-16 flex-1 bg-transparent text-[13px] outline-none placeholder:text-neutral-300"
        onChange={(e) => {
          if (e.target.value.endsWith(',')) {
            const tag = e.target.value.slice(0, -1).trim();
            if (tag) onChange([...value, tag]);
            setDraft('');
          } else {
            setDraft(e.target.value);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}
