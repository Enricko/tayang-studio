import type { Autopilot, AutopilotFrequency } from '@tayang/shared';

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
