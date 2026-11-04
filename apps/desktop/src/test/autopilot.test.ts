import { describe, expect, it } from 'vitest';
import type { AutopilotFrequency } from '@tayang/shared';
import { planSlots } from '@/lib/autopilot';

const plan = (frequency: AutopilotFrequency, from: Date, days: number) =>
  planSlots({ frequency }, from, days).map((d) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()].join(','));

describe('planSlots', () => {
  it('daily: every time on every day, oldest first', () => {
    const from = new Date(2026, 10, 4, 6, 0);
    expect(plan({ kind: 'daily', times: ['19:00', '12:00'] }, from, 2)).toEqual(['2026,11,4,12,0', '2026,11,4,19,0', '2026,11,5,12,0', '2026,11,5,19,0']);
  });

  it('leaves out times today that are already past, and the exact present moment', () => {
    const from = new Date(2026, 10, 4, 12, 0);
    expect(plan({ kind: 'daily', times: ['09:00', '12:00', '12:01'] }, from, 1)).toEqual(['2026,11,4,12,1']);
  });

  it('weekly: only the chosen weekdays (0 is Sunday) at the one time', () => {
    // 2026-11-04 is a Wednesday (3).
    const from = new Date(2026, 10, 4, 0, 0);
    expect(plan({ kind: 'weekly', days: [1, 5, 0], time: '08:30' }, from, 7)).toEqual(['2026,11,6,8,30', '2026,11,8,8,30', '2026,11,9,8,30']);
    expect(plan({ kind: 'weekly', days: [3], time: '08:30' }, from, 8)).toEqual(['2026,11,4,8,30', '2026,11,11,8,30']);
  });

  it('seven days with six times a day gives 42, and zero days gives none', () => {
    const times = ['06:00', '09:00', '12:00', '15:00', '18:00', '21:00'];
    expect(planSlots({ frequency: { kind: 'daily', times } }, new Date(2026, 10, 4, 0, 0), 7)).toHaveLength(42);
    expect(planSlots({ frequency: { kind: 'daily', times } }, new Date(2026, 10, 4, 0, 0), 0)).toEqual([]);
  });

  it('crosses month and year ends', () => {
    expect(plan({ kind: 'daily', times: ['10:00'] }, new Date(2026, 11, 31, 8, 0), 2)).toEqual(['2026,12,31,10,0', '2027,1,1,10,0']);
  });

  it('keeps every clock time on the days the clocks change, in any zone', () => {
    // Local-parts arithmetic: 02:30 (which may not exist that night) and 12:00 never drift to another hour.
    for (const start of [new Date(2026, 2, 7, 0, 0), new Date(2026, 9, 31, 0, 0), new Date(2026, 10, 1, 0, 0)]) {
      const out = planSlots({ frequency: { kind: 'daily', times: ['12:00', '18:00'] } }, start, 4);
      expect(out.map((d) => [d.getHours(), d.getMinutes()])).toEqual([[12, 0], [18, 0], [12, 0], [18, 0], [12, 0], [18, 0], [12, 0], [18, 0]]);
    }
  });

  it('drops a time listed twice', () => {
    expect(plan({ kind: 'daily', times: ['09:00', '09:00'] }, new Date(2026, 10, 4, 0, 0), 1)).toEqual(['2026,11,4,9,0']);
  });
});
