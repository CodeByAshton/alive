// App settings — one synced record (.vault/settings.md frontmatter), so a
// theme picked on the desktop follows you to the phone. Reads merge over
// defaults, writes go through the same putRecord path as any note.

import { useMemo } from 'react';
import { parseFrontmatter, serializeFrontmatter } from '../../shared/frontmatter.mjs';
import { putRecord } from './sync';
import { useVault } from './store';
import type { VaultRecord } from './types';

export const SETTINGS_PATH = '.vault/settings.md';

export interface AppSettings {
  theme: string;
  accent: string;
  uiScale: number; // percent
  reduceMotion: boolean;
  highContrast: boolean;
  // Enabled plugin ids; null means "no explicit choice yet" (defaults apply).
  plugins: string[] | null;
  // Sidebar menu customization. Order is a preference list (registry items
  // not named — e.g. added later by a plugin — append in default order);
  // hidden is an explicit removal list, so new items show up by default.
  menuOrder: string[] | null;
  menuHidden: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  accent: 'indigo',
  uiScale: 100,
  reduceMotion: false,
  highContrast: false,
  plugins: null,
  menuOrder: null,
  menuHidden: [],
};

export function getSettings(records: Map<string, VaultRecord>): AppSettings {
  const rec = records.get(SETTINGS_PATH);
  if (!rec) return DEFAULT_SETTINGS;
  const { data } = parseFrontmatter(rec.content);
  return {
    theme: typeof data.theme === 'string' ? data.theme : DEFAULT_SETTINGS.theme,
    accent: typeof data.accent === 'string' ? data.accent : DEFAULT_SETTINGS.accent,
    uiScale: typeof data.uiScale === 'number' ? data.uiScale : DEFAULT_SETTINGS.uiScale,
    reduceMotion: data.reduceMotion === true,
    highContrast: data.highContrast === true,
    plugins: Array.isArray(data.plugins) ? data.plugins.map(String) : null,
    menuOrder: Array.isArray(data.menuOrder) ? data.menuOrder.map(String) : null,
    menuHidden: Array.isArray(data.menuHidden) ? data.menuHidden.map(String) : [],
  };
}

export async function updateSettings(
  records: Map<string, VaultRecord>,
  patch: Partial<AppSettings>
): Promise<void> {
  const next = { ...getSettings(records), ...patch };
  const data: Record<string, unknown> = {
    theme: next.theme,
    accent: next.accent,
    uiScale: next.uiScale,
    reduceMotion: next.reduceMotion,
    highContrast: next.highContrast,
  };
  if (next.plugins !== null) data.plugins = next.plugins;
  if (next.menuOrder !== null) data.menuOrder = next.menuOrder;
  if (next.menuHidden.length) data.menuHidden = next.menuHidden;
  await putRecord(
    SETTINGS_PATH,
    'file',
    serializeFrontmatter(data, 'App settings — edit from Settings in the sidebar. Synced to every device.\n')
  );
}

export function useSettings(): AppSettings {
  const records = useVault((s) => s.records);
  return useMemo(() => getSettings(records), [records]);
}
