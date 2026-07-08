export interface ScheduleSpec {
  kind: 'daily' | 'weekdays' | 'weekly' | 'minutes' | 'hours' | 'once';
  hh?: number;
  mm?: number;
  day?: number;
  n?: number;
  y?: number;
  mo?: number;
  d?: number;
}

export function parseSchedule(raw: unknown): ScheduleSpec | null;
export function nextOccurrence(spec: ScheduleSpec | null, fromMs: number, timeZone?: string): number | null;
export function nextOccurrences(spec: ScheduleSpec | null, fromMs: number, count: number, timeZone?: string): number[];
export function isDue(spec: ScheduleSpec, sinceMs: number, nowMs: number, timeZone?: string): boolean;
