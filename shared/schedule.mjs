// Automation schedule grammar, shared by server and client. The server's
// scheduler asks "did an occurrence pass?" (isDue); the phone asks "when are
// the next occurrences?" (nextOccurrences) so it can mirror reminders into
// iOS local notifications that fire with the app closed.
//
// Grammar: daily HH:MM | weekdays HH:MM | weekly <mon..sun> HH:MM |
//          every N minutes | every N hours | once YYYY-MM-DD HH:MM
// Fixed times are wall-clock in the given IANA timezone (undefined = the
// environment's own zone — on a phone, the device's).

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function parseSchedule(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
  let m;
  if ((m = s.match(/^daily (?:at )?(\d{1,2}):(\d{2})$/))) return { kind: 'daily', hh: +m[1], mm: +m[2] };
  if ((m = s.match(/^weekdays (?:at )?(\d{1,2}):(\d{2})$/))) return { kind: 'weekdays', hh: +m[1], mm: +m[2] };
  if ((m = s.match(/^weekly (sun|mon|tue|wed|thu|fri|sat)[a-z]* (?:at )?(\d{1,2}):(\d{2})$/)))
    return { kind: 'weekly', day: WEEKDAYS.indexOf(m[1]), hh: +m[2], mm: +m[3] };
  if ((m = s.match(/^every (\d+) minutes?$/))) return { kind: 'minutes', n: Math.max(1, +m[1]) };
  if ((m = s.match(/^every (\d+) hours?$/))) return { kind: 'hours', n: Math.max(1, +m[1]) };
  if ((m = s.match(/^once (\d{4})-(\d{2})-(\d{2})[ t](\d{1,2}):(\d{2})$/)))
    return { kind: 'once', y: +m[1], mo: +m[2], d: +m[3], hh: +m[4], mm: +m[5] };
  return null;
}

// Wall-clock parts of a timestamp in a timezone, via Intl (no tz database
// dependency). Falls back to the environment's zone on a bad timezone string.
function zonedParts(ms, timeZone) {
  let fmt;
  const options = {
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short',
  };
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: timeZone || undefined, ...options });
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', options);
  }
  const parts = Object.fromEntries(fmt.formatToParts(ms).map((p) => [p.type, p.value]));
  return {
    y: +parts.year, mo: +parts.month, d: +parts.day,
    hh: +parts.hour % 24, mm: +parts.minute,
    day: WEEKDAYS.indexOf(parts.weekday.slice(0, 3).toLowerCase()),
  };
}

// Next occurrence strictly after `fromMs`, or null (a 'once' that already
// passed, or an unparseable spec). Fixed-time kinds converge by jumping to
// the target wall-clock time and re-checking — one Intl call per jump, so DST
// shifts self-correct.
export function nextOccurrence(spec, fromMs, timeZone) {
  if (!spec) return null;
  if (spec.kind === 'minutes') {
    const step = spec.n * 60_000;
    return (Math.floor(fromMs / step) + 1) * step;
  }
  let t = (Math.floor(fromMs / 60_000) + 1) * 60_000; // next whole minute
  const target = (spec.hh ?? 0) * 60 + (spec.mm ?? 0);
  for (let guard = 0; guard < 500; guard++) {
    const p = zonedParts(t, timeZone);
    if (spec.kind === 'hours') {
      if (p.mm === 0 && p.hh % spec.n === 0) return t;
      t += (60 - p.mm) * 60_000; // step to the next hour boundary
      continue;
    }
    const cur = p.hh * 60 + p.mm;
    let delta = target - cur;
    if (delta < 0) delta += 1440;
    if (delta === 0) {
      const dayOk =
        spec.kind === 'daily' ||
        (spec.kind === 'weekdays' && p.day >= 1 && p.day <= 5) ||
        (spec.kind === 'weekly' && p.day === spec.day) ||
        spec.kind === 'once';
      if (spec.kind === 'once') {
        const date = p.y * 10_000 + p.mo * 100 + p.d;
        const want = spec.y * 10_000 + spec.mo * 100 + spec.d;
        if (date === want) return t;
        if (date > want) return null;
      } else if (dayOk) {
        return t;
      }
      t += 1440 * 60_000; // right time, wrong day — try tomorrow
    } else {
      t += delta * 60_000;
    }
  }
  return null;
}

export function nextOccurrences(spec, fromMs, count, timeZone) {
  const out = [];
  let t = fromMs;
  for (let i = 0; i < count; i++) {
    const next = nextOccurrence(spec, t, timeZone);
    if (next === null) break;
    out.push(next);
    t = next;
  }
  return out;
}

const MISSED_GRACE_MS = 26 * 60 * 60 * 1000;

// Did an occurrence land in (since, now]? Missed occurrences (server asleep)
// collapse into a single late firing inside the grace window — a late
// reminder beats a silently dropped one.
export function isDue(spec, sinceMs, nowMs, timeZone) {
  const start = Math.max(sinceMs, nowMs - MISSED_GRACE_MS);
  const next = nextOccurrence(spec, start, timeZone);
  return next !== null && next <= nowMs;
}
