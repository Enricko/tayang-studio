import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingStatus } from '@tayang/shared';

vi.mock('@/lib/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing')>()),
  billingCheckout: vi.fn(),
  billingStatus: vi.fn(),
}));

import * as billing from '@/lib/billing';
import { POLL_MS } from '@/lib/billing';
import { useAuth } from '@/state/auth';
import { useBilling } from '@/state/billing';

const NOW = new Date('2026-11-04T12:00:00.000Z');
const free: BillingStatus = { plan: 'free', lastPlan: null, currentPeriodEnd: null, active: false, pending: null, lastPaidOrderId: null };
const creator: BillingStatus = { plan: 'creator', lastPlan: 'creator', currentPeriodEnd: '2026-12-04T12:00:00.000Z', active: true, pending: null, lastPaidOrderId: null };
const checkout = { orderId: 'TYG-A', paymentLinkUrl: 'https://pay.sumopod.com/p/1', expiresAt: '2026-11-04T13:00:00.000Z', amount: 50000 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.resetAllMocks();
  useBilling.getState().reset();
  vi.mocked(billing.billingStatus).mockResolvedValue(free);
  vi.mocked(billing.billingCheckout).mockResolvedValue(checkout);
});
afterEach(() => {
  useBilling.getState().close();
  vi.useRealTimers();
});

describe('the plans flow', () => {
  it('pick → review → pay: waits, polls every 5 s, and succeeds when the plan runs', async () => {
    useBilling.getState().open();
    expect(useBilling.getState().flow).toEqual({ phase: 'picking' });
    useBilling.getState().choose('creator');
    expect(useBilling.getState().flow).toEqual({ phase: 'review', plan: 'creator' });
    await useBilling.getState().pay('creator');
    expect(billing.billingCheckout).toHaveBeenCalledWith('creator');
    expect(useBilling.getState().flow).toMatchObject({ phase: 'waiting', plan: 'creator', checkout, startedAt: NOW.getTime() });
    vi.mocked(billing.billingStatus).mockClear();
    await vi.advanceTimersByTimeAsync(POLL_MS - 1);
    expect(billing.billingStatus).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(billing.billingStatus).toHaveBeenCalledTimes(1);
    vi.mocked(billing.billingStatus).mockResolvedValue({ ...creator, lastPaidOrderId: 'TYG-A' });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(useBilling.getState().flow).toEqual({ phase: 'done', plan: 'creator', currentPeriodEnd: creator.currentPeriodEnd });
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(billing.billingStatus).toHaveBeenCalledTimes(2);
  });

  it('back from review goes to picking', () => {
    useBilling.getState().open();
    useBilling.getState().choose('pro');
    useBilling.getState().back();
    expect(useBilling.getState().flow).toEqual({ phase: 'picking' });
  });

  it('a renewal succeeds only once the end moves', async () => {
    vi.mocked(billing.billingStatus).mockResolvedValue(creator);
    await useBilling.getState().refresh();
    await useBilling.getState().pay('creator');
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(useBilling.getState().flow.phase).toBe('waiting');
    vi.mocked(billing.billingStatus).mockResolvedValue({ ...creator, currentPeriodEnd: '2027-01-03T12:00:00.000Z', lastPaidOrderId: 'TYG-A' });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(useBilling.getState().flow).toMatchObject({ phase: 'done', currentPeriodEnd: '2027-01-03T12:00:00.000Z' });
  });

  it('stops polling when the link expires, and a new link starts over', async () => {
    await useBilling.getState().pay('lite');
    await vi.advanceTimersByTimeAsync(60 * 60_000 + POLL_MS);
    expect(useBilling.getState().flow).toMatchObject({ phase: 'expired', plan: 'lite', checkout });
    const calls = vi.mocked(billing.billingStatus).mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(billing.billingStatus).toHaveBeenCalledTimes(calls);
    vi.mocked(billing.billingCheckout).mockResolvedValueOnce({ ...checkout, orderId: 'TYG-B', expiresAt: '2026-11-04T14:30:00.000Z' });
    await useBilling.getState().pay('lite');
    expect(useBilling.getState().flow).toMatchObject({ phase: 'waiting', checkout: { orderId: 'TYG-B' } });
  });

  it('resumes a pending payment straight into waiting, without a new checkout', async () => {
    vi.mocked(billing.billingStatus).mockResolvedValue({
      ...free,
      pending: { orderId: 'TYG-P', plan: 'pro', paymentLinkUrl: checkout.paymentLinkUrl, expiresAt: checkout.expiresAt },
    });
    await useBilling.getState().enter();
    expect(useBilling.getState().flow).toMatchObject({
      phase: 'waiting',
      plan: 'pro',
      checkout: { orderId: 'TYG-P', paymentLinkUrl: checkout.paymentLinkUrl, expiresAt: checkout.expiresAt, amount: 90000 },
    });
    expect(billing.billingCheckout).not.toHaveBeenCalled();
  });

  it('entering with nothing pending starts at picking', async () => {
    await useBilling.getState().enter();
    expect(useBilling.getState().flow).toEqual({ phase: 'picking' });
  });

  it('closing stops polling', async () => {
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
    vi.mocked(billing.billingStatus).mockResolvedValue({ ...creator, plan: 'lite', lastPlan: 'lite', lastPaidOrderId: 'TYG-A' });
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

  it('a checkout answered after closing is dropped', async () => {
    await useBilling.getState().refresh();
    let answer!: (c: typeof checkout) => void;
    vi.mocked(billing.billingCheckout).mockReturnValueOnce(new Promise((r) => (answer = r)));
    const p = useBilling.getState().pay('lite');
    useBilling.getState().close();
    answer(checkout);
    await p;
    expect(useBilling.getState().flow.phase).toBe('closed');
  });

  it('a link off the payment hosts fails as bad_link and is never waited on (M5)', async () => {
    vi.mocked(billing.billingCheckout).mockResolvedValueOnce({ ...checkout, paymentLinkUrl: 'https://pay.example/p/1' });
    await useBilling.getState().pay('lite');
    expect(useBilling.getState().flow).toEqual({ phase: 'failed', plan: 'lite', error: 'bad_link' });
  });

  it('reads the status before paying, so a renewal is not seen as paid at once (M8)', async () => {
    vi.mocked(billing.billingStatus).mockResolvedValue(creator);
    await useBilling.getState().pay('creator');
    expect(billing.billingStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(useBilling.getState().flow.phase).toBe('waiting');
  });

  it("success needs this checkout's order AND a later end: another payment, or an unchanged end, is not it (review2 I-A)", async () => {
    vi.mocked(billing.billingStatus).mockResolvedValue(creator);
    await useBilling.getState().pay('creator');
    // Someone else's payment moved the end.
    vi.mocked(billing.billingStatus).mockResolvedValue({ ...creator, currentPeriodEnd: '2027-01-03T12:00:00.000Z', lastPaidOrderId: 'TYG-OTHER' });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(useBilling.getState().flow.phase).toBe('waiting');
    // Our order, but the end didn't move.
    vi.mocked(billing.billingStatus).mockResolvedValue({ ...creator, lastPaidOrderId: 'TYG-A' });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(useBilling.getState().flow.phase).toBe('waiting');
  });

  it('a late lower-plan payment that became days on the current plan still counts as done (B3)', async () => {
    vi.mocked(billing.billingStatus).mockResolvedValue({ ...creator, plan: 'pro', lastPlan: 'pro' });
    await useBilling.getState().refresh();
    useBilling.setState({ flow: { phase: 'review', plan: 'pro' } });
    await useBilling.getState().pay('pro');
    vi.mocked(billing.billingStatus).mockResolvedValue({ ...creator, plan: 'pro', lastPlan: 'pro', currentPeriodEnd: '2027-01-03T12:00:00.000Z', lastPaidOrderId: 'TYG-A' });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(useBilling.getState().flow.phase).toBe('done');
  });

  it("pay always reads the status first, and never checks out when it can't (review2 I-A)", async () => {
    vi.mocked(billing.billingStatus).mockResolvedValue(free);
    await useBilling.getState().refresh();
    vi.mocked(billing.billingStatus).mockClear();
    vi.mocked(billing.billingStatus).mockRejectedValueOnce('billing:network');
    await useBilling.getState().pay('creator');
    expect(billing.billingStatus).toHaveBeenCalledTimes(1);
    expect(billing.billingCheckout).not.toHaveBeenCalled();
    expect(useBilling.getState().flow).toEqual({ phase: 'failed', plan: 'creator', error: 'network' });
  });

  it('a signed-out read while the app is signed in is "unknown", never free (review2 Gratis)', async () => {
    useAuth.setState({ status: { state: 'signed-in', signedIn: true, offline: false, apiUrl: 'x' } });
    vi.mocked(billing.billingStatus).mockRejectedValue('billing:signed-out');
    expect(await useBilling.getState().refresh()).toBeNull();
    expect(useBilling.getState().failed).toBe(true);
    useAuth.setState({ status: null });
  });

  it('signed out clears the status', async () => {
    vi.mocked(billing.billingStatus).mockResolvedValue(creator);
    await useBilling.getState().refresh();
    vi.mocked(billing.billingStatus).mockRejectedValue('billing:signed-out');
    expect(await useBilling.getState().refresh()).toBeNull();
    expect(useBilling.getState().status).toBeNull();
  });
});
