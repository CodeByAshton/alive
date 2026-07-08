// Sidebar menu registry. The item list is data so it stays extensible —
// a plugin can register an entry here later — and the user's order/visibility
// preferences live in the synced settings record. Unknown-to-preferences
// items (e.g. newly added by a plugin) appear by default, in default order,
// so customization never buries new features.

import { Folder, MessageSquare, MonitorSmartphone, SlidersHorizontal, Waypoints } from 'lucide-react';
import { getSettings, updateSettings, type AppSettings } from './settings';
import { useVault } from './store';

export interface MenuItemDef {
  id: string;
  label: string;
  icon: typeof Folder;
}

export const MENU_REGISTRY: MenuItemDef[] = [
  { id: 'files', label: 'Files', icon: Folder },
  { id: 'chats', label: 'Chats', icon: MessageSquare },
  { id: 'customize', label: 'Customize', icon: SlidersHorizontal },
  { id: 'graph', label: 'Graph', icon: Waypoints },
  { id: 'devices', label: 'Devices', icon: MonitorSmartphone },
];

// Registry items in the user's preferred order (hidden ones included).
export function orderedMenu(settings: AppSettings): MenuItemDef[] {
  const order = settings.menuOrder ?? [];
  const ids = MENU_REGISTRY.map((m) => m.id);
  const sorted = [...order.filter((id) => ids.includes(id)), ...ids.filter((id) => !order.includes(id))];
  return sorted.map((id) => MENU_REGISTRY.find((m) => m.id === id)!);
}

export function visibleMenu(settings: AppSettings): MenuItemDef[] {
  return orderedMenu(settings).filter((m) => !settings.menuHidden.includes(m.id));
}

export function isMenuCustomized(settings: AppSettings): boolean {
  return settings.menuOrder !== null || settings.menuHidden.length > 0;
}

// Mutations read the live store, not a caller-captured map — back-to-back
// calls (or a stale prop) must not clobber each other's writes.
export async function moveMenuItem(id: string, delta: -1 | 1): Promise<void> {
  const records = useVault.getState().records;
  const order = orderedMenu(getSettings(records)).map((m) => m.id);
  const idx = order.indexOf(id);
  const to = idx + delta;
  if (idx === -1 || to < 0 || to >= order.length) return;
  [order[idx], order[to]] = [order[to], order[idx]];
  await updateSettings(records, { menuOrder: order });
}

export async function setMenuItemHidden(id: string, hidden: boolean): Promise<void> {
  const records = useVault.getState().records;
  const current = getSettings(records).menuHidden;
  const menuHidden = hidden ? [...new Set([...current, id])] : current.filter((h) => h !== id);
  // Never allow hiding the last visible item.
  if (menuHidden.length >= MENU_REGISTRY.length) return;
  await updateSettings(records, { menuHidden });
}

export async function resetMenu(): Promise<void> {
  await updateSettings(useVault.getState().records, { menuOrder: null, menuHidden: [] });
}
