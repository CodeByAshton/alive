// Per-chat model picker. Switching provider/model mid-thread keeps the whole
// conversation — continuity lives in the harness, not the model.

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useVault } from '../lib/store';
import { getChatConfig, setChatConfig } from '../lib/chat';

export function ModelPicker({ chatPath }: { chatPath: string }) {
  const providers = useVault((s) => s.providers);
  const records = useVault((s) => s.records);
  const config = getChatConfig(records, chatPath);
  const current = `${config.provider}::${config.model}`;

  const known = providers.some((p) => p.models.includes(config.model));

  return (
    <Select
      value={current}
      onValueChange={async (value) => {
        const [provider, model] = value.split('::');
        await setChatConfig(records, chatPath, { provider, model });
      }}
    >
      <SelectTrigger
        size="sm"
        className="model-picker max-w-44 border-transparent font-mono text-[11px] text-neutral-500 shadow-none hover:bg-accent"
        title="Model"
      >
        <SelectValue placeholder="Model" />
      </SelectTrigger>
      <SelectContent align="end">
        {!known && (
          <SelectItem value={current} className="font-mono text-xs">
            {config.model}
          </SelectItem>
        )}
        {providers.map((p) => (
          <SelectGroup key={p.id}>
            <SelectLabel>{p.label}</SelectLabel>
            {p.models.map((m) => (
              <SelectItem key={`${p.id}::${m}`} value={`${p.id}::${m}`} disabled={!p.available} className="font-mono text-xs">
                {m}
                {!p.available ? ' — no key' : ''}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
