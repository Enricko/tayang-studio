import { describe, expect, it, vi } from 'vitest';

vi.mock('posthog-js', () => ({ default: { init: vi.fn(), capture: vi.fn(), identify: vi.fn(), register: vi.fn(), opt_in_capturing: vi.fn(), opt_out_capturing: vi.fn(), has_opted_out_capturing: vi.fn(() => false), has_opted_in_capturing: vi.fn(() => false), get_distinct_id: vi.fn(), setPersonProperties: vi.fn(), reset: vi.fn(), captureException: vi.fn() } }));

import posthog from 'posthog-js';
import { beforeSend, identifyAccount, startAnalytics, track, trackError } from '@/lib/analytics';

describe('analytics', () => {
  it('takes home folders out of everything it sends, error messages too', () => {
    const out = beforeSend({
      uuid: 'u',
      event: '$exception',
      properties: {
        where: 'render',
        $exception_list: [{ value: "Couldn't read /Users/maruf/Tayang/x/AGENTS.md" }],
        nested: { path: 'C:\\Users\\Budi\\Tayang\\a.mp4', list: ['/home/sari/Tayang'] },
        count: 3,
      },
    } as never);
    expect(out!.properties).toEqual({
      where: 'render',
      $exception_list: [{ value: "Couldn't read ~/Tayang/x/AGENTS.md" }],
      nested: { path: '~\\Tayang\\a.mp4', list: ['~/Tayang'] },
      count: 3,
    });
  });

  it('sends nothing without a key (tests, forks), whatever the setting says', () => {
    startAnalytics({ share: true, installId: 'i1' });
    track('video posted', { accounts: 2 });
    identifyAccount('acc', 'creator');
    trackError(new Error('x'), 'render');
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(posthog.identify).not.toHaveBeenCalled();
  });
});
