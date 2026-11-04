import { describe, expect, it } from 'vitest';
import type { Project } from '@tayang/shared';
import { dueReminders, REVIEW_LEAD_MS, MISSED_WINDOW_MS } from '@/lib/reminders';

const H = 3_600_000;
const due = new Date('2026-11-05T10:00:00Z');
const p = (extra: Partial<Project> = {}): Project => ({
  id: 'p', title: 'Kopi', slug: 'kopi', folder: '/w/kopi', kind: 'promo', format: '9:16', language: 'id',
  status: 'rendered', styleId: null, scheduledAt: due.toISOString(), reviewState: 'none', postedAt: null,
  remindedAt: null, reviewRemindedAt: null, durationSec: null, createdAt: 'c', updatedAt: 'u', ...extra,
});
const at = (ms: number) => new Date(due.getTime() + ms);
const kinds = (list: Project[], now: Date) => dueReminders(list, now).map((r) => `${r.project.id}:${r.kind}`);

describe('dueReminders', () => {
  it('has the documented constants', () => {
    expect(REVIEW_LEAD_MS).toBe(2 * H);
    expect(MISSED_WINDOW_MS).toBe(24 * H);
  });

  it('reminds to post once the time has come', () => {
    expect(kinds([p()], at(-1000))).toEqual([]);
    expect(kinds([p()], at(0))).toEqual(['p:post']);
    expect(kinds([p()], at(30 * 60_000))).toEqual(['p:post']);
  });

  it('asks to review a pending video from two hours before, and only that', () => {
    const pending = p({ reviewState: 'pending' });
    expect(kinds([pending], at(-2 * H - 1))).toEqual([]);
    expect(kinds([pending], at(-2 * H))).toEqual(['p:review']);
    // At and after the due time it is still the review reminder, never "time to post".
    expect(kinds([pending], at(H))).toEqual(['p:review']);
  });

  it('a video that was approved after its review reminder gets the post reminder when due', () => {
    const approved = p({ reviewState: 'approved', reviewRemindedAt: '2026-11-05T08:00:00Z' });
    expect(kinds([approved], at(-1000))).toEqual([]);
    expect(kinds([approved], at(0))).toEqual(['p:post']);
  });

  it('fires each reminder once', () => {
    expect(kinds([p({ remindedAt: '2026-11-05T10:00:30Z' })], at(H))).toEqual([]);
    expect(kinds([p({ reviewState: 'pending', reviewRemindedAt: '2026-11-05T08:00:30Z' })], at(H))).toEqual([]);
  });

  it('skips posted, unscheduled and unparsable schedules', () => {
    expect(kinds([p({ postedAt: '2026-11-05T09:00:00Z' })], at(H))).toEqual([]);
    expect(kinds([p({ scheduledAt: null })], at(H))).toEqual([]);
    expect(kinds([p({ scheduledAt: 'soon' })], at(H))).toEqual([]);
  });

  it('missed while closed: reminds on launch only within the last 24 hours', () => {
    expect(kinds([p()], at(MISSED_WINDOW_MS))).toEqual(['p:post']);
    expect(kinds([p()], at(MISSED_WINDOW_MS + 1))).toEqual([]);
    expect(kinds([p({ reviewState: 'pending' })], at(MISSED_WINDOW_MS + 1))).toEqual([]);
  });

  it('lists several videos, earliest due first', () => {
    const a = p({ id: 'a', scheduledAt: at(-H).toISOString() });
    const b = p({ id: 'b', scheduledAt: at(-3 * H).toISOString() });
    const c = p({ id: 'c', scheduledAt: at(5 * H).toISOString() });
    expect(kinds([a, b, c], at(0))).toEqual(['b:post', 'a:post']);
  });
});
