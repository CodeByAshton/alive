// Reminder delivery for a pocketed phone. Two channels, no push servers:
//
// 1. Mirrored schedules (native app): automation files sync to every device,
//    so the phone computes upcoming occurrences itself (shared/schedule.mjs,
//    device timezone) and registers them as iOS *local* notifications — they
//    fire on a locked phone with the app closed, no APNs involved. Re-mirrored
//    whenever automations change or the app resumes.
// 2. Live notify events: while the app is open in the background (web tab or
//    native), a firing automation's actual message becomes a system
//    notification; foreground surfaces show the in-app toast instead.
//
// The durable record is still .vault/notifications.md. What local mirroring
// can't know is dynamic script output — a conditional notify() only reaches a
// closed app late (on next open, via sync). Real APNs push is the eventual
// answer for that; scheduled reminders — the common case — need none of it.

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { nextOccurrences, parseSchedule } from '../../shared/schedule.mjs';
import { listAutomations, type Automation } from './automations';
import { useVault } from './store';

const PREF_KEY = 'vault-notifications';
const MAX_PENDING = 60; // iOS caps pending local notifications at 64 per app
const PER_AUTOMATION = 12;

const isNative = () => Capacitor.isNativePlatform();

export function notificationsSupported(): boolean {
  return isNative() || 'Notification' in window;
}

export function notificationsEnabled(): boolean {
  return localStorage.getItem(PREF_KEY) === 'on';
}

export async function setNotificationsEnabled(on: boolean): Promise<boolean> {
  if (!on) {
    localStorage.setItem(PREF_KEY, 'off');
    if (isNative()) await cancelAllMirrored().catch(() => {});
    return false;
  }
  const granted = isNative()
    ? (await LocalNotifications.requestPermissions()).display === 'granted'
    : 'Notification' in window && (await Notification.requestPermission()) === 'granted';
  localStorage.setItem(PREF_KEY, granted ? 'on' : 'off');
  if (granted) await mirrorSchedules();
  return granted;
}

/* ── live events (app open, possibly backgrounded) ─────────────────────── */

export function notifyLive(title: string, message: string): void {
  if (!notificationsEnabled() || !document.hidden) return; // foreground shows the toast
  if (isNative()) {
    LocalNotifications.schedule({
      notifications: [{ id: liveId(), title, body: message }],
    }).catch(() => {});
  } else if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body: message, tag: 'vault-live' });
    } catch {
      /* some webviews expose Notification but refuse construction */
    }
  }
}

let liveSeq = 0;
function liveId(): number {
  // Live ids sit in their own range so mirroring never cancels/collides.
  return 2_000_000_000 + (++liveSeq % 100_000);
}

/* ── mirrored schedules (native only — fire with the app closed) ───────── */

// The notification body: the script's own static notify('...') text when
// there is one (the whole script, for a plain reminder), else the automation's
// one-line description.
function bodyFor(a: Automation): string {
  const literal = a.script.match(/notify\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*\)/);
  return (literal?.[2] || a.description || a.about).slice(0, 180);
}

// Deterministic 31-bit id per (path, occurrence) so re-mirroring is idempotent.
function occurrenceId(path: string, at: number): number {
  let h = Math.floor(at / 60_000) | 0;
  for (let i = 0; i < path.length; i++) h = (Math.imul(h, 31) + path.charCodeAt(i)) | 0;
  return Math.abs(h) % 1_900_000_000; // below the live-id range
}

async function cancelAllMirrored(): Promise<void> {
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) {
    await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  }
}

let mirroring = false;
export async function mirrorSchedules(): Promise<void> {
  if (!isNative() || !notificationsEnabled() || mirroring) return;
  mirroring = true;
  try {
    const automations = listAutomations(useVault.getState().records).filter(
      (a) => a.enabled && a.status === 'active' && parseSchedule(a.schedule)
    );
    const now = Date.now();
    const upcoming = automations
      .flatMap((a) =>
        nextOccurrences(parseSchedule(a.schedule), now, PER_AUTOMATION).map((at) => ({
          id: occurrenceId(a.path, at),
          title: a.name,
          body: bodyFor(a),
          schedule: { at: new Date(at) },
        }))
      )
      .sort((x, y) => x.schedule.at.getTime() - y.schedule.at.getTime())
      .slice(0, MAX_PENDING);

    // Replace wholesale: the app owns all of its local notifications, and a
    // cancel+schedule round trip is cheap next to keeping diff state honest.
    await cancelAllMirrored();
    if (upcoming.length) await LocalNotifications.schedule({ notifications: upcoming });
  } catch {
    /* permissions revoked in Settings, or webview without the plugin */
  } finally {
    mirroring = false;
  }
}

/* ── wiring ─────────────────────────────────────────────────────────────── */

let started = false;
export function initNotifications(): void {
  if (started) return;
  started = true;
  if (!isNative()) return; // web needs no schedule mirroring, only notifyLive

  // Re-mirror when automation files change (created, edited, toggled, run
  // bookkeeping bumps last_run) and when the app comes back to foreground.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSnapshot = '';
  const remirror = () => {
    clearTimeout(timer);
    timer = setTimeout(() => mirrorSchedules(), 1500);
  };
  useVault.subscribe((state) => {
    const snapshot = [...state.records.keys()]
      .filter((p) => p.startsWith('.vault/automations/'))
      .map((p) => `${p}@${state.records.get(p)!.rev}`)
      .join('|');
    if (snapshot !== lastSnapshot) {
      lastSnapshot = snapshot;
      remirror();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) remirror();
  });
  remirror();
}
