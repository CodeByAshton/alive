// Settings — tabbed: General (assistant mode + standing instructions),
// Appearance (theme gallery, accent, UI scale), Accessibility, and Account.
// Appearance/accessibility changes apply instantly and sync to every device
// via the .vault/settings.md record; instructions save on demand.

import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  LogOut,
  Palette,
  PencilRuler,
  PersonStanding,
  Puzzle,
  RotateCcw,
  Settings,
  Settings2,
  UserRound,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useVault } from '../lib/store';
import { putRecord, setAssistantMode } from '../lib/sync';
import { getServerConfig } from '../lib/config';
import { authMode, authQuery, getAuthClient, signOut } from '../lib/auth';
import { getDeviceId, getSurface } from '../lib/device';
import { ACCENTS, THEMES, type Theme } from '../lib/appearance';
import { enabledPlugins, setPluginEnabled, PLUGINS } from '../lib/plugins';
import {
  isMenuCustomized,
  moveMenuItem,
  orderedMenu,
  resetMenu,
  setMenuItemHidden,
  visibleMenu,
} from '../lib/menu';
import { updateSettings, useSettings, type AppSettings } from '../lib/settings';
import type { AssistantMode } from '../lib/types';

const AGENT_PATH = '.vault/AGENT.md';

const MODES: { id: AssistantMode; label: string; hint: string }[] = [
  { id: 'ask', label: 'Ask first', hint: 'Every command waits for your approval on-screen.' },
  { id: 'auto', label: 'Auto', hint: 'Commands run without asking. Use with care.' },
  { id: 'readonly', label: 'Read-only', hint: 'The assistant never runs commands.' },
];

const UI_SCALES = [90, 100, 110, 120];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-0.5 text-[11px] font-medium tracking-wide text-neutral-400 uppercase">{children}</div>;
}

function SettingRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border bg-neutral-50/60 px-3.5 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-neutral-800">{title}</div>
        {hint && <div className="mt-0.5 text-xs leading-relaxed text-neutral-500">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/* ── General ──────────────────────────────────────────────────────────── */

function GeneralSection({ draft, setDraft }: { draft: string; setDraft: (v: string) => void }) {
  const mode = useVault((s) => s.mode);
  const current = MODES.find((m) => m.id === mode) ?? MODES[0];

  return (
    <div className="flex flex-col gap-4">
      <SettingRow title="Default mode" hint={current.hint}>
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
      </SettingRow>

      <div className="flex flex-col gap-1.5">
        <div className="px-0.5 text-[13px] font-medium text-neutral-800">Assistant instructions</div>
        <Textarea
          value={draft}
          rows={9}
          className="leading-relaxed"
          placeholder="e.g. Keep answers short. New notes go under notes/. Always confirm before deleting anything."
          onChange={(e) => setDraft(e.target.value)}
        />
        <p className="px-0.5 text-xs text-neutral-400">
          You can also just tell the assistant how you'd like it to behave — it updates this itself.
        </p>
      </div>
    </div>
  );
}

/* ── Appearance ───────────────────────────────────────────────────────── */

function ThemeCard({ theme, active, onPick }: { theme: Theme; active: boolean; onPick: () => void }) {
  return (
    <button
      className={cn(
        'theme-card group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border text-left transition-all',
        active ? 'border-neutral-500 ring-1 ring-neutral-500/40' : 'hover:border-neutral-300'
      )}
      onClick={onPick}
    >
      {/* miniature window */}
      <span className="block h-16 w-full border-b" style={{ background: theme.preview.canvas }}>
        <span
          className="mt-3 ml-3 block h-13 w-3/4 rounded-t-md border px-2 py-1.5"
          style={{ background: theme.preview.card, borderColor: theme.preview.border }}
        >
          <span className="block h-1.5 w-2/3 rounded-full" style={{ background: theme.preview.text, opacity: 0.85 }} />
          <span className="mt-1 block h-1.5 w-5/6 rounded-full" style={{ background: theme.preview.text, opacity: 0.35 }} />
          <span className="mt-1 block h-1.5 w-1/2 rounded-full" style={{ background: theme.preview.text, opacity: 0.35 }} />
        </span>
      </span>
      <span className="flex items-center gap-1.5 px-3 py-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-neutral-800">{theme.name}</span>
          <span className="block truncate text-[11px] text-neutral-400">{theme.description}</span>
        </span>
        {active && <Check className="size-3.5 shrink-0 text-neutral-700" />}
      </span>
    </button>
  );
}

// Sidebar menu manager — reorder and show/hide the sidebar's menu items,
// including any a plugin registers later. Mirrors the right-click menu on
// the items themselves.
function SidebarMenuSection({ settings }: { settings: AppSettings }) {
  const ordered = orderedMenu(settings);
  const visibleCount = visibleMenu(settings).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <SectionLabel>Sidebar menu</SectionLabel>
        {isMenuCustomized(settings) && (
          <Button
            variant="ghost"
            size="xs"
            className="menu-reset -my-1 text-neutral-400"
            onClick={() => resetMenu()}
          >
            <RotateCcw className="size-3" /> Reset
          </Button>
        )}
      </div>
      <div className="menu-manager flex flex-col divide-y rounded-xl border bg-neutral-50/60">
        {ordered.map((item, i) => {
          const visible = !settings.menuHidden.includes(item.id);
          return (
            <div key={item.id} data-menu-item={item.id} className="flex items-center gap-2.5 px-3 py-2">
              <item.icon className="size-4 shrink-0 text-neutral-400" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-800">{item.label}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6 text-neutral-400"
                title="Move up"
                disabled={i === 0}
                onClick={() => moveMenuItem(item.id, -1)}
              >
                <ArrowUp className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6 text-neutral-400"
                title="Move down"
                disabled={i === ordered.length - 1}
                onClick={() => moveMenuItem(item.id, 1)}
              >
                <ArrowDown className="size-3.5" />
              </Button>
              <Switch
                checked={visible}
                disabled={visible && visibleCount <= 1}
                onCheckedChange={(v) => setMenuItemHidden(item.id, !v)}
                aria-label={`Show ${item.label} in the sidebar`}
              />
            </div>
          );
        })}
      </div>
      <p className="px-0.5 text-xs leading-relaxed text-neutral-400">
        Reorder or hide the sidebar's menu items — handy when plugins add their own. You can also right-click
        an item in the sidebar.
      </p>
    </div>
  );
}

function AppearanceSection({ settings }: { settings: AppSettings }) {
  const records = useVault((s) => s.records);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SectionLabel>Theme</SectionLabel>
        <div className="theme-gallery grid grid-cols-2 gap-2.5">
          {THEMES.map((t) => (
            <ThemeCard
              key={t.id}
              theme={t}
              active={settings.theme === t.id}
              onPick={() => updateSettings(records, { theme: t.id })}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Accent</SectionLabel>
        <div className="accent-row flex items-center gap-2 px-0.5">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              title={a.name}
              className={cn(
                'size-6 cursor-pointer rounded-full transition-transform hover:scale-110',
                settings.accent === a.id && 'ring-2 ring-neutral-400 ring-offset-2 ring-offset-background'
              )}
              style={{ background: a.value }}
              onClick={() => updateSettings(records, { accent: a.id })}
            />
          ))}
          <span className="ml-1 text-xs text-neutral-400">Colors wikilinks and highlights.</span>
        </div>
      </div>

      <SettingRow title="Interface scale" hint="Make everything a touch larger or smaller.">
        <Select
          value={String(settings.uiScale)}
          onValueChange={(v) => updateSettings(records, { uiScale: Number(v) })}
        >
          <SelectTrigger size="sm" className="w-24 shrink-0 bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {UI_SCALES.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s}%
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <SidebarMenuSection settings={settings} />
    </div>
  );
}

/* ── Editor ───────────────────────────────────────────────────────────── */

function EditorSection({ settings }: { settings: AppSettings }) {
  const records = useVault((s) => s.records);
  return (
    <div className="flex flex-col gap-3">
      <SettingRow title="Open notes in" hint="How a note appears when you click it in the tree or search.">
        <Select
          value={settings.defaultMode}
          onValueChange={(v) => updateSettings(records, { defaultMode: v as 'read' | 'edit' })}
        >
          <SelectTrigger size="sm" className="default-mode-select w-32 shrink-0 bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="read">Reading view</SelectItem>
            <SelectItem value="edit">Edit view</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow title="Content width" hint="The measure of the note column, in both views.">
        <Select
          value={settings.contentWidth}
          onValueChange={(v) => updateSettings(records, { contentWidth: v as 'normal' | 'wide' })}
        >
          <SelectTrigger size="sm" className="w-32 shrink-0 bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="wide">Wide</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      <p className="px-0.5 text-xs leading-relaxed text-neutral-400">
        Edit view is a live preview — headings, bold, links and code style themselves as you type. In reading
        view, task checkboxes are clickable and edit the note directly.
      </p>
    </div>
  );
}

/* ── Plugins ──────────────────────────────────────────────────────────── */

function PluginsSection() {
  const records = useVault((s) => s.records);
  const enabled = enabledPlugins(records);
  return (
    <div className="flex flex-col gap-3">
      {PLUGINS.map((plugin) => (
        <SettingRow key={plugin.id} title={plugin.name} hint={plugin.description}>
          <Switch
            checked={enabled.has(plugin.id)}
            onCheckedChange={(v) => setPluginEnabled(plugin.id, v)}
            aria-label={`Toggle ${plugin.name}`}
          />
        </SettingRow>
      ))}
      <p className="px-0.5 text-xs leading-relaxed text-neutral-400">
        Also available under Customize → Plugins in the sidebar.
      </p>
    </div>
  );
}

/* ── Accessibility ────────────────────────────────────────────────────── */

function AccessibilitySection({ settings }: { settings: AppSettings }) {
  const records = useVault((s) => s.records);
  return (
    <div className="flex flex-col gap-3">
      <SettingRow title="Reduce motion" hint="Turns off animations and transitions app-wide.">
        <Switch
          checked={settings.reduceMotion}
          onCheckedChange={(v) => updateSettings(records, { reduceMotion: v })}
        />
      </SettingRow>
      <SettingRow title="High contrast" hint="Stronger borders and darker secondary text.">
        <Switch
          checked={settings.highContrast}
          onCheckedChange={(v) => updateSettings(records, { highContrast: v })}
        />
      </SettingRow>
      <SettingRow title="Interface scale" hint="Also available under Appearance.">
        <Select
          value={String(settings.uiScale)}
          onValueChange={(v) => updateSettings(records, { uiScale: Number(v) })}
        >
          <SelectTrigger size="sm" className="w-24 shrink-0 bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {UI_SCALES.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s}%
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <p className="px-0.5 text-xs leading-relaxed text-neutral-400">
        The system-level “reduce motion” preference is always respected, whether or not the switch above is on.
      </p>
    </div>
  );
}

/* ── Account ──────────────────────────────────────────────────────────── */

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3.5 py-2.5">
      <span className="text-[12.5px] text-neutral-500">{label}</span>
      <span className="min-w-0 truncate font-mono text-[12px] text-neutral-800">{value}</span>
    </div>
  );
}

function AccountSection() {
  const [email, setEmail] = useState<string | null>(null);
  const server = getServerConfig();
  const accounts = authMode() === 'accounts';

  useEffect(() => {
    if (!accounts) return;
    getAuthClient()
      ?.auth.getSession()
      .then(({ data }) => setEmail(data.session?.user.email ?? null));
  }, [accounts]);

  return (
    <div className="flex flex-col gap-4">
      <div className="account-info flex flex-col divide-y rounded-xl border bg-neutral-50/60">
        <InfoRow label="Signed in as" value={accounts ? (email ?? '…') : 'Shared vault key (self-hosted)'} />
        {/* httpBase is '' for same-origin setups — show the actual origin */}
        <InfoRow label="Server" value={server ? server.httpBase || location.origin : '—'} />
        <InfoRow label="This device" value={`${getSurface()} · ${getDeviceId(getSurface())}`} />
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Your data</SectionLabel>
        <SettingRow title="Export vault" hint="Download everything as a zip of Markdown files.">
          <Button
            variant="outline"
            size="sm"
            className="export-vault shrink-0"
            onClick={async () => {
              if (server) window.open(`${server.httpBase}/api/export?${await authQuery()}`, '_blank');
            }}
          >
            <Download className="size-3.5" /> Export
          </Button>
        </SettingRow>
        {accounts && (
          <SettingRow title="Sign out" hint="This device only — your vault stays in the cloud.">
            <Button
              variant="outline"
              size="sm"
              className="sign-out shrink-0"
              onClick={async () => {
                await signOut();
                location.reload();
              }}
            >
              <LogOut className="size-3.5" /> Sign out
            </Button>
          </SettingRow>
        )}
      </div>
    </div>
  );
}

/* ── dialog shell: side menu of sections, content on the right ────────── */

const SECTIONS = [
  { id: 'general', label: 'General', icon: Settings2, hint: 'Assistant mode and standing instructions.' },
  { id: 'editor', label: 'Editor', icon: PencilRuler, hint: 'How notes open and read.' },
  { id: 'appearance', label: 'Appearance', icon: Palette, hint: 'Theme, accent, scale, and the sidebar menu.' },
  { id: 'accessibility', label: 'Accessibility', icon: PersonStanding, hint: 'Motion, contrast, and size.' },
  { id: 'plugins', label: 'Plugins', icon: Puzzle, hint: 'Built-in features you can switch on and off.' },
  { id: 'account', label: 'Account', icon: UserRound, hint: 'Identity, server, and your data.' },
] as const;

export function SettingsDialog() {
  const record = useVault((s) => s.records.get(AGENT_PATH));
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<(typeof SECTIONS)[number]['id']>('general');
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (open) {
      setDraft(record?.content ?? '');
      setTab('general');
    }
  }, [open, record?.content]);

  const save = async () => {
    if (draft !== (record?.content ?? '')) await putRecord(AGENT_PATH, 'file', draft);
    setOpen(false);
  };

  const current = SECTIONS.find((s) => s.id === tab) ?? SECTIONS[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" title="Settings">
          <Settings className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="settings-dialog flex h-[80vh] max-h-[680px] flex-row gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Shared by every device — change it here, see it everywhere.
        </DialogDescription>

        {/* side menu */}
        <aside className="settings-nav flex w-48 shrink-0 flex-col gap-px border-r bg-neutral-50/70 p-3">
          <div className="px-2 pt-0.5 pb-3 text-sm font-semibold tracking-tight">Settings</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              data-section={s.id}
              className={cn(
                'flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 text-[13px] font-medium transition-colors select-none',
                tab === s.id
                  ? 'bg-white text-neutral-900 shadow-xs'
                  : 'text-neutral-600 hover:bg-neutral-200/55 hover:text-neutral-900'
              )}
              onClick={() => setTab(s.id)}
            >
              <s.icon className="size-4 text-neutral-400" />
              {s.label}
            </button>
          ))}
          <span className="flex-1" />
          <p className="px-2 pb-1 text-[10.5px] leading-relaxed text-neutral-400">
            Settings sync to every device.
          </p>
        </aside>

        {/* section content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-5">
            <span className="text-[13px] font-semibold">{current.label}</span>
            <span className="truncate text-[11.5px] text-neutral-400">{current.hint}</span>
          </header>
          <div className="quiet-scroll flex-1 overflow-y-auto p-5">
            {tab === 'general' && <GeneralSection draft={draft} setDraft={setDraft} />}
            {tab === 'editor' && <EditorSection settings={settings} />}
            {tab === 'appearance' && <AppearanceSection settings={settings} />}
            {tab === 'accessibility' && <AccessibilitySection settings={settings} />}
            {tab === 'plugins' && <PluginsSection />}
            {tab === 'account' && <AccountSection />}
          </div>
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
