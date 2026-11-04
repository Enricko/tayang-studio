import type { Autopilot, AutopilotFrequency } from '@tayang/shared';
import { i18n, locale } from '@/i18n';

/** Video lengths an autopilot offers, in seconds. */
export const LENGTHS = [15, 30, 45, 60, 90];
/** At most this many daily times. */
export const MAX_TIMES = 6;
/** Monday first; the number is `Date.getDay()` (0 is Sunday), what the model stores. */
export const WEEK = [1, 2, 3, 4, 5, 6, 0];

/** The short weekday name in the active language (2024-01-07 is a Sunday). */
export const dayName = (day: number) => new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(new Date(2024, 0, 7 + day));

export const isTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
/** 1 to 6 different HH:MM times, as the Rust validation wants. */
export const validTimes = (times: string[]) =>
  times.length >= 1 && times.length <= MAX_TIMES && times.every(isTime) && new Set(times).size === times.length;

/** "2 a day · 12:00, 19:00" or "3 a week · Mon, Wed, Fri · 09:00". */
export function frequencyLabel(a: Pick<Autopilot, 'frequency'>): string {
  const f = a.frequency;
  if (f.kind === 'daily') return i18n.t('autopilot.daily', { count: f.times.length, times: [...f.times].sort().join(', ') });
  const days = WEEK.filter((d) => f.days.includes(d)).map(dayName).join(', ');
  return i18n.t('autopilot.weekly', { count: f.days.length, days, time: f.time });
}

const pad = (n: number) => String(n).padStart(2, '0');
/** "Thu 5 Nov 12:00" in the active language, 24-hour clock. */
export function slotTime(d: Date): string {
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale(), o).format(d);
  return `${part({ weekday: 'short' })} ${d.getDate()} ${part({ month: 'short' })} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const parseTime = (t: string): [number, number] => {
  const [h = 0, m = 0] = t.split(':').map(Number);
  return [h, m];
};

/**
 * The moments `autopilot` is due to make a video, in the computer's local time, from the calendar
 * day of `from` for `days` days (day 0 is today). A moment that is not after `from` is left out.
 * Weekly days follow `Date.getDay()`: 0 is Sunday. Each moment is built from local calendar parts,
 * so a daylight-saving change never shifts it off its clock time. Oldest first, no duplicates.
 */
export function planSlots(autopilot: Pick<Autopilot, 'frequency'>, from: Date, days: number): Date[] {
  const f: AutopilotFrequency = autopilot.frequency;
  const out: Date[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const times = f.kind === 'daily' ? f.times : f.days.includes(day.getDay()) ? [f.time] : [];
    for (const t of times) {
      const [h, m] = parseTime(t);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
      if (at.getTime() > from.getTime()) out.push(at);
    }
  }
  const seen = new Set<number>();
  return out
    .sort((a, b) => a.getTime() - b.getTime())
    .filter((d) => !seen.has(d.getTime()) && !!seen.add(d.getTime()));
}
