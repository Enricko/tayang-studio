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

  it('keeps clock times across daylight saving, in a zone that has it', () => {
    const was = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      // 2026-03-08: clocks jump 02:00 to 03:00, so 02:30 does not exist and lands on 03:30 (deduped with 03:30).
      const out = planSlots({ frequency: { kind: 'daily', times: ['02:30', '03:30', '12:00'] } }, new Date(2026, 2, 7, 0, 0), 3);
      const hm = (d: Date) => `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
      expect(out.map(hm)).toEqual(['3/7 2:30', '3/7 3:30', '3/7 12:00', '3/8 3:30', '3/8 12:00', '3/9 2:30', '3/9 3:30', '3/9 12:00']);
      // 2026-11-01: clocks fall back; every time still appears exactly once per day, on its own clock face.
      const fall = planSlots({ frequency: { kind: 'daily', times: ['01:30', '12:00'] } }, new Date(2026, 9, 31, 0, 0), 3);
      expect(fall.map(hm)).toEqual(['10/31 1:30', '10/31 12:00', '11/1 1:30', '11/1 12:00', '11/2 1:30', '11/2 12:00']);
    } finally {
      if (was === undefined) delete process.env.TZ;
      else process.env.TZ = was;
    }
  });

  it('drops a time listed twice', () => {
    expect(plan({ kind: 'daily', times: ['09:00', '09:00'] }, new Date(2026, 10, 4, 0, 0), 1)).toEqual(['2026,11,4,9,0']);
  });
});
