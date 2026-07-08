// Full-screen plugin manager under Customize: the built-in plugin set as a
// gallery of cards with on/off switches. State syncs to every device.

import { CalendarDays, LayoutTemplate, Link2, ListTree, Puzzle, Sigma } from 'lucide-react';

import { Switch } from '@/components/ui/switch';
import { useVault } from '../lib/store';
import { enabledPlugins, setPluginEnabled, PLUGINS } from '../lib/plugins';

const PLUGIN_ICONS: Record<string, typeof Puzzle> = {
  backlinks: Link2,
  outline: ListTree,
  'word-count': Sigma,
  'daily-notes': CalendarDays,
  templates: LayoutTemplate,
};

export function PluginsView() {
  const records = useVault((s) => s.records);
  const enabled = enabledPlugins(records);

  return (
    <div className="plugins-view flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Puzzle className="size-4 text-neutral-500" />
        <span className="text-[13px] font-semibold">Plugins</span>
      </header>
      <div className="quiet-scroll flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 px-8 py-8">
          <p className="text-[13px] leading-relaxed text-neutral-500">
            Built-in plugins — flip one on and its features appear across the app; flip it off and they
            disappear. Your choices sync to every device.
          </p>
          <div className="flex flex-col gap-2.5">
            {PLUGINS.map((plugin) => {
              const Icon = PLUGIN_ICONS[plugin.id] ?? Puzzle;
              const on = enabled.has(plugin.id);
              return (
                <div
                  key={plugin.id}
                  data-plugin={plugin.id}
                  className="plugin-card flex items-center gap-3.5 rounded-2xl border bg-white px-4 py-3.5 shadow-xs"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl border bg-neutral-50">
                    <Icon className="size-4 text-neutral-500" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-neutral-900">{plugin.name}</span>
                    <span className="block text-[12px] leading-relaxed text-neutral-500">{plugin.description}</span>
                  </span>
                  <Switch
                    checked={on}
                    onCheckedChange={(v) => setPluginEnabled(plugin.id, v)}
                    aria-label={`Toggle ${plugin.name}`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
