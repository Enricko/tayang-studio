import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthStatus, BillingStatus } from '@tayang/shared';

vi.mock('@tauri-apps/plugin-notification', () => ({ isPermissionGranted: vi.fn(), requestPermission: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@/lib/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing')>()),
  billingStatus: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { isPermissionGranted } from '@tauri-apps/plugin-notification';
import * as billing from '@/lib/billing';
import { REMINDED_KEY, runBillingReminder } from '@/lib/billingReminder';
import { setUiLanguage } from '@/i18n';
import { useAuth } from '@/state/auth';
import { useBilling } from '@/state/billing';

const DAY = 86_400_000;
const END = '2026-12-04T12:00:00.000Z';
const creator: BillingStatus = { plan: 'creator', lastPlan: 'creator', currentPeriodEnd: END, active: true, pending: null };
const signedIn = { state: 'signed-in', signedIn: true, offline: false, apiUrl: 'x' } as AuthStatus;
const at = (msBeforeEnd: number) => new Date(Date.parse(END) - msBeforeEnd);
const notified = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === 'plugin:notification|notify')
    .map(([, args]) => (args as { options: { body: string } }).options.body);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useBilling.getState().reset();
  useAuth.setState({ status: signedIn, listening: true });
  vi.mocked(isPermissionGranted).mockResolvedValue(true);
  vi.mocked(invoke).mockResolvedValue(undefined);
  vi.mocked(billing.billingStatus).mockResolvedValue(creator);
});

describe('plan-ends-soon reminder', () => {
  it('notifies once, 3 days before the end', async () => {
    await runBillingReminder(at(4 * DAY));
    expect(notified()).toEqual([]);
    await runBillingReminder(at(3 * DAY));
    expect(notified()).toEqual(['Your Tayang plan ends in 3 days']);
    expect(localStorage.getItem(REMINDED_KEY)).toBe(END);
    await runBillingReminder(at(2 * DAY));
    expect(notified()).toHaveLength(1);
  });

  it('says the days left when Tayang was closed at the 3-day mark, in Indonesian', async () => {
    setUiLanguage('id');
    await runBillingReminder(at(DAY - 60_000));
    expect(notified()).toEqual(['Paket Tayang-mu habis dalam 1 hari']);
  });

  it('a renewed plan reminds again before its new end', async () => {
    localStorage.setItem(REMINDED_KEY, '2026-11-04T12:00:00.000Z');
    await runBillingReminder(at(DAY));
    expect(notified()).toHaveLength(1);
  });

  it('asks the API at most every 6 hours', async () => {
    await runBillingReminder(at(10 * DAY));
    await runBillingReminder(at(10 * DAY - 60_000));
    expect(billing.billingStatus).toHaveBeenCalledTimes(1);
    useBilling.setState({ loadedAt: Date.now() - 7 * 3_600_000 });
    await runBillingReminder(at(9 * DAY));
    expect(billing.billingStatus).toHaveBeenCalledTimes(2);
  });

  it('nothing when signed out or free', async () => {
    useAuth.setState({ status: { ...signedIn, state: 'signed-out', signedIn: false } });
    await runBillingReminder(at(DAY));
    expect(billing.billingStatus).not.toHaveBeenCalled();
    useAuth.setState({ status: signedIn });
    vi.mocked(billing.billingStatus).mockResolvedValue({ plan: 'free', lastPlan: null, currentPeriodEnd: null, active: false, pending: null });
    await runBillingReminder(at(DAY));
    expect(notified()).toEqual([]);
  });
});
