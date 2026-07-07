// Per-chat model picker. Switching provider/model mid-thread keeps the whole
// conversation — continuity lives in the harness, not the model.

import { useVault } from '../lib/store';
import { getChatConfig, setChatConfig } from '../lib/chat';

export function ModelPicker({ chatPath }: { chatPath: string }) {
  const providers = useVault((s) => s.providers);
  const records = useVault((s) => s.records);
  const config = getChatConfig(records, chatPath);

  const options = providers.flatMap((p) =>
    p.models.map((m) => ({
      value: `${p.id}::${m}`,
      label: `${p.label} · ${m}`,
      disabled: !p.available,
    }))
  );

  const current = `${config.provider}::${config.model}`;
  if (!options.some((o) => o.value === current)) {
    options.unshift({ value: current, label: `${config.provider} · ${config.model}`, disabled: false });
  }

  return (
    <select
      className="model-picker mono"
      value={current}
      onChange={async (e) => {
        const [provider, model] = e.target.value.split('::');
        await setChatConfig(records, chatPath, { provider, model });
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
          {o.disabled ? ' (no key)' : ''}
        </option>
      ))}
    </select>
  );
}
