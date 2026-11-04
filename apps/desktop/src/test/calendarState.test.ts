import { describe, expect, it } from 'vitest';
import type { Project } from '@tayang/shared';
import { calendarState } from '@/lib/calendarState';

const p = (extra: Partial<Project>): Project => ({
  id: 'p',
  title: 'T',
  slug: 't',
  folder: '/w/t',
  kind: 'promo',
  format: '9:16',
  language: 'id',
  status: 'draft',
  styleId: null,
  scheduledAt: null,
  reviewState: 'none',
  postedAt: null,
  remindedAt: null, reviewRemindedAt: null,
  durationSec: null,
  createdAt: '',
  updatedAt: '',
  ...extra,
});
const now = new Date(2026, 10, 4);

describe('calendarState', () => {
  it.each([
    [{ status: 'building' }, 'making'],
    // Building no longer hides a review or a post (a status moves on by itself now).
    [{ status: 'building', reviewState: 'pending' }, 'needs-review'],
    [{ status: 'building', postedAt: '2026-11-05T00:00:00Z' }, 'posted'],
    [{ status: 'rendered', reviewState: 'pending' }, 'needs-review'],
    [{ status: 'rendered', reviewState: 'pending', postedAt: '2026-11-05T00:00:00Z' }, 'needs-review'],
    [{ status: 'rendered', postedAt: '2026-11-05T00:00:00Z' }, 'posted'],
    [{ status: 'draft', postedAt: '2026-11-05T00:00:00Z' }, 'posted'],
    [{ status: 'rendered' }, 'ready'],
    [{ status: 'scheduled' }, 'ready'],
    [{ status: 'rendered', reviewState: 'approved' }, 'ready'],
    [{ status: 'draft' }, 'draft'],
    [{ status: 'draft', reviewState: 'approved' }, 'draft'],
  ] as [Partial<Project>, string][])('%j is %s', (extra, state) => {
    expect(calendarState(p(extra), now)).toBe(state);
  });
});
