import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingStatus } from '@tayang/shared';

vi.mock('@/lib/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing')>()),
  billingCheckout: vi.fn(),
  billingStatus: vi.fn(),
}));

import * as billing from '@/lib/billing';
import { POLL_LIMIT_MS, POLL_MS } from '@/lib/billing';
import { useBilling } from '@/state/billing';

const free: BillingStatus = { plan: 'free', currentPeriodEnd: null, active: false, pending: null };
const creator: BillingStatus = { plan: 'creator', currentPeriodEnd: '2026-12-04T12:00:00.000Z', active: true, pending: null };
const checkout = { orderId: 'TYG-A', paymentLinkUrl: 'https://pay.example/p/1', expiresAt: '2026-11-04T13:00:00.000Z', amount: 50000 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useBilling.getState().reset();
  useBilling.setState({ ...useBilling.getInitialState(), attempt: useBilling.getState().attempt });
  vi.mocked(billing.billingStatus).mockResolvedValue(free);
  vi.mocked(billing.billingCheckout).mockResolvedValue(checkout);
});
afterEach(() => {
  useBilling.getState().close();
  vi.useRealTimers();
});

describe('paying', () => {
  it('waits for the browser, polls every 5 s, and succeeds when the plan runs', async () => {
    await useBilling.getState().refresh();
    await useBilling.getState().pay('creator');
    expect(billing.billingCheckout).toHaveBeenCalledWith('creator');
    expect(useBilling.getState().flow).toMatchObject({ phase: 'waiting', plan: 'creator', checkout });
    vi.mocked(billing.billingStatus).mockClear();
    await vi.advanceTimersByTimeAsync(POLL_MS - 1);
    expect(billing.billingStatus).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(billing.billingStatus).toHaveBeenCalledTimes(1);
    expect(useBilling.getState().flow.phase).toBe('waiting');
    vi.mocked(billing.billingStatus).mockResolvedValue(creator);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(useBilling.getState().flow).toEqual({ phase: 'done', plan: 'creator', currentPeriodEnd: creator.currentPeriodEnd });
    expect(useBilling.getState().status).toEqual(creator);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(billing.billingStatus).toHaveBeenCalledTimes(2);
  });

  it('a renewal succeeds only once the end moves', async () => {
    vi.mocked(billing.billingStatus).mockResolvedValue(creator);
    await useBilling.getState().refresh();
    await useBilling.getState().pay('creator');
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(useBilling.getState().flow.phase).toBe('waiting');
    vi.mocked(billing.billingStatus).mockResolvedValue({ ...creator, currentPeriodEnd: '2027-01-03T12:00:00.000Z' });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(useBilling.getState().flow).toMatchObject({ phase: 'done', currentPeriodEnd: '2027-01-03T12:00:00.000Z' });
  });

  it('stops after 30 minutes, and Check again looks for another while', async () => {
    await useBilling.getState().pay('lite');
    await vi.advanceTimersByTimeAsync(POLL_LIMIT_MS + POLL_MS);
    expect(useBilling.getState().flow).toMatchObject({ phase: 'timeout', plan: 'lite', checkout });
    const calls = vi.mocked(billing.billingStatus).mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(billing.billingStatus).toHaveBeenCalledTimes(calls);
    useBilling.getState().checkAgain();
    vi.mocked(billing.billingStatus).mockResolvedValue({ ...creator, plan: 'lite' });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(useBilling.getState().flow.phase).toBe('done');
  });

  it('closing the dialog stops polling', async () => {
    await useBilling.getState().pay('lite');
    useBilling.getState().close();
    vi.mocked(billing.billingStatus).mockClear();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(billing.billingStatus).not.toHaveBeenCalled();
    expect(useBilling.getState().flow.phase).toBe('closed');
  });

  it('keeps polling through a failed status read', async () => {
    await useBilling.getState().pay('lite');
    vi.mocked(billing.billingStatus).mockRejectedValueOnce('billing:network');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(useBilling.getState().flow.phase).toBe('waiting');
    vi.mocked(billing.billingStatus).mockResolvedValue({ ...creator, plan: 'lite' });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(useBilling.getState().flow.phase).toBe('done');
  });

  it('a failed checkout shows its code, or the raw message', async () => {
    vi.mocked(billing.billingCheckout).mockRejectedValueOnce('billing:payment-provider');
    await useBilling.getState().pay('pro');
    expect(useBilling.getState().flow).toEqual({ phase: 'failed', plan: 'pro', error: 'payment-provider' });
    vi.mocked(billing.billingCheckout).mockRejectedValueOnce(new Error('boom'));
    await useBilling.getState().pay('pro');
    expect(useBilling.getState().flow).toEqual({ phase: 'failed', plan: 'pro', error: { message: 'boom' } });
  });

  it('a checkout answered after the dialog closed is dropped', async () => {
    let answer!: (c: typeof checkout) => void;
    vi.mocked(billing.billingCheckout).mockReturnValueOnce(new Promise((r) => (answer = r)));
    const p = useBilling.getState().pay('lite');
    useBilling.getState().close();
    answer(checkout);
    await p;
    expect(useBilling.getState().flow.phase).toBe('closed');
  });

  it('signed out clears the status', async () => {
    vi.mocked(billing.billingStatus).mockResolvedValue(creator);
    await useBilling.getState().refresh();
    vi.mocked(billing.billingStatus).mockRejectedValue('billing:signed-out');
    expect(await useBilling.getState().refresh()).toBeNull();
    expect(useBilling.getState().status).toBeNull();
  });
});
