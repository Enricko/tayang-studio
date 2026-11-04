import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthStatus, BillingStatus } from '@tayang/shared';

vi.mock('@/lib/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing')>()),
  billingCheckout: vi.fn(),
  billingStatus: vi.fn(),
}));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  authStart: vi.fn(),
  authCancel: vi.fn().mockResolvedValue(undefined),
  authStatus: vi.fn(),
  onAuthChanged: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock('@/lib/confetti', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/confetti')>()),
  fireConfetti: vi.fn(() => () => {}),
  prefersReducedMotion: vi.fn(() => false),
}));
vi.mock('@/lib/scheduler', () => ({ canNotify: vi.fn().mockResolvedValue(true), show: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));

import { openUrl } from '@tauri-apps/plugin-opener';
import { setUiLanguage } from '@/i18n';
import * as auth from '@/lib/auth';
import * as billing from '@/lib/billing';
import { POLL_MS } from '@/lib/billing';
import { fireConfetti, prefersReducedMotion } from '@/lib/confetti';
import { show } from '@/lib/scheduler';
import { Plans, clock } from '@/screens/Plans';
import { useApp } from '@/state/app';
import { useAuth } from '@/state/auth';
import { useBilling } from '@/state/billing';

const NOW = new Date('2026-11-04T12:00:00.000Z');
const free: BillingStatus = { plan: 'free', lastPlan: null, currentPeriodEnd: null, active: false, pending: null };
const creator: BillingStatus = { plan: 'creator', lastPlan: 'creator', currentPeriodEnd: '2026-12-04T12:00:00.000Z', active: true, pending: null };
const checkout = { orderId: 'TYG-A', paymentLinkUrl: 'https://pay.sumopod.com/p/1', expiresAt: '2026-11-04T13:00:00.000Z', amount: 50000 };
const signedIn: AuthStatus = {
  state: 'signed-in',
  signedIn: true,
  offline: false,
  apiUrl: 'http://localhost:8787/api',
  account: { id: 'acc_1', email: 'a@b.c', name: 'Ana', plan: 'free', features: [] },
};
const signedOut: AuthStatus = { state: 'signed-out', signedIn: false, offline: false, apiUrl: 'http://localhost:8787/api' };

const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  vi.mocked(prefersReducedMotion).mockReturnValue(false);
  useBilling.getState().reset();
  useAuth.setState({ ...useAuth.getInitialState(), status: signedIn, listening: true });
  useApp.setState({ route: { name: 'plans', from: 'settings' }, leaveGuard: null });
  vi.mocked(auth.authStatus).mockResolvedValue(signedIn);
  vi.mocked(billing.billingStatus).mockResolvedValue(free);
  vi.mocked(billing.billingCheckout).mockResolvedValue(checkout);
});
afterEach(() => {
  vi.useRealTimers();
});

async function toPayStep(u = user()) {
  render(<Plans from="settings" />);
  await u.click(await screen.findByRole('radio', { name: 'Creator' }));
  await u.click(screen.getByRole('button', { name: 'Continue to payment' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Pay with QRIS' })).toHaveFocus();
  return u;
}

describe('plans screen: choose', () => {
  it('three plans with prices, Creator marked most popular and picked first, always-free strip, QRIS note', async () => {
    render(<Plans from="settings" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Let Tayang do the posting' })).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'Plans' });
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    expect(within(group).getByRole('radio', { name: 'Creator' })).toBeChecked();
    expect(screen.getByText('Most popular')).toBeInTheDocument();
    expect(screen.getByText('Rp15,000')).toBeInTheDocument();
    expect(screen.getByText('Rp50,000')).toBeInTheDocument();
    expect(screen.getByText('Rp90,000')).toBeInTheDocument();
    expect(screen.getByText('For posting regularly every day')).toBeInTheDocument();
    expect(screen.getByText('150 auto-posts a month')).toBeInTheDocument();
    expect(screen.getByText('Always free')).toBeInTheDocument();
    expect(screen.getByText(/Nothing is charged automatically/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Plan steps' })).toBeInTheDocument();
  });

  it('arrow keys move between the plan cards', async () => {
    const u = user();
    render(<Plans from="settings" />);
    const creatorRadio = await screen.findByRole('radio', { name: 'Creator' });
    await u.click(creatorRadio);
    await u.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Pro' })).toHaveFocus();
    await u.keyboard(' ');
    expect(screen.getByRole('radio', { name: 'Pro' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeInTheDocument();
  });

  it('marks your plan and its button reads Renew', async () => {
    vi.mocked(billing.billingStatus).mockResolvedValue(creator);
    render(<Plans from="settings" />);
    expect(await screen.findByText('Your plan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Renew' })).toBeInTheDocument();
  });

  it('in Indonesian', async () => {
    setUiLanguage('id');
    render(<Plans from="settings" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Biar Tayang yang tayangin' })).toBeInTheDocument();
    expect(screen.getByText('Paling populer')).toBeInTheDocument();
    expect(screen.getByText('Rp50.000')).toBeInTheDocument();
    expect(screen.getAllByText('/bulan').length).toBe(3);
    expect(screen.getByRole('button', { name: 'Lanjut bayar' })).toBeInTheDocument();
    expect(screen.getByText(/Tidak ada tagihan otomatis/)).toBeInTheDocument();
  });

  it('signed out: signs in with Google first, then carries on to paying', async () => {
    useAuth.setState({ status: signedOut });
    vi.mocked(auth.authStart).mockReturnValue(new Promise(() => {}));
    const u = user();
    render(<Plans from="settings" />);
    await u.click(await screen.findByRole('button', { name: 'Sign in with Google first' }));
    expect(auth.authStart).toHaveBeenCalled();
    // The sign-in dialog is over the screen, which is still on step 1.
    expect(screen.getByRole('heading', { level: 1, name: 'Let Tayang do the posting', hidden: true })).toBeInTheDocument();
    act(() => useAuth.getState().apply(signedIn));
    expect(await screen.findByRole('heading', { level: 1, name: 'Pay with QRIS' })).toBeInTheDocument();
    expect(billing.billingCheckout).not.toHaveBeenCalled();
  });
});

describe('plans screen: pay', () => {
  it('summary, then Open the QRIS page checks out, waits with a countdown, and Open again reopens it', async () => {
    const u = await toPayStep();
    expect(screen.getByText('Creator plan')).toBeInTheDocument();
    expect(screen.getByText('Active for 30 days from when the payment arrives')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Open the QRIS page' }));
    expect(billing.billingCheckout).toHaveBeenCalledWith('creator');
    expect(await screen.findByText(/this page changes by itself/)).toBeInTheDocument();
    expect(screen.getByText(/^Link expires in (1:00:00|59:5\d)$/)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText('Waiting for 0:02')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Open again' }));
    expect(openUrl).toHaveBeenCalledWith(checkout.paymentLinkUrl);
  });

  it('renewing previews the new end date', async () => {
    vi.mocked(billing.billingStatus).mockResolvedValue(creator);
    const u = user();
    render(<Plans from="settings" />);
    await screen.findByText('Your plan');
    await u.click(screen.getByRole('button', { name: 'Renew' }));
    expect(await screen.findByText('Your plan then runs until Jan 3, 2027')).toBeInTheDocument();
  });

  it('Change plan goes back to step 1', async () => {
    const u = await toPayStep();
    await u.click(screen.getByRole('button', { name: 'Change plan' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Let Tayang do the posting' })).toHaveFocus();
  });

  it('when the link expires: Link expired, and Make a new link checks out again', async () => {
    const u = await toPayStep();
    await u.click(screen.getByRole('button', { name: 'Open the QRIS page' }));
    await screen.findByText(/this page changes by itself/);
    await act(() => vi.advanceTimersByTimeAsync(60 * 60_000 + POLL_MS));
    expect(await screen.findByText('Link expired')).toBeInTheDocument();
    vi.mocked(billing.billingCheckout).mockResolvedValueOnce({ ...checkout, orderId: 'TYG-B', expiresAt: '2026-11-04T14:30:00.000Z' });
    await u.click(screen.getByRole('button', { name: 'Make a new link' }));
    expect(billing.billingCheckout).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/this page changes by itself/)).toBeInTheDocument();
  });

  it('entering with a pending payment goes straight to waiting on it', async () => {
    vi.mocked(billing.billingStatus).mockResolvedValue({
      ...free,
      pending: { orderId: 'TYG-P', plan: 'pro', paymentLinkUrl: checkout.paymentLinkUrl, expiresAt: checkout.expiresAt },
    });
    render(<Plans from="settings" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Pay with QRIS' })).toBeInTheDocument();
    expect(screen.getByText('Pro plan')).toBeInTheDocument();
    expect(screen.getByText(/this page changes by itself/)).toBeInTheDocument();
    expect(billing.billingCheckout).not.toHaveBeenCalled();
  });

  it('shows why a checkout failed, e.g. payments not open yet', async () => {
    vi.mocked(billing.billingCheckout).mockRejectedValueOnce('billing:unavailable');
    const u = await toPayStep();
    await u.click(screen.getByRole('button', { name: 'Open the QRIS page' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Payments aren't available yet");
  });
});

describe('plans screen: leaving', () => {
  it('Back returns to where you came from', async () => {
    const u = user();
    render(<Plans from="autopilot" />);
    await u.click(await screen.findByRole('button', { name: 'Back' }));
    expect(useApp.getState().route).toEqual({ name: 'autopilot' });
  });

  it('Esc leaves at once, but asks first while a payment is waiting', async () => {
    const u = await toPayStep();
    await u.click(screen.getByRole('button', { name: 'Open the QRIS page' }));
    await screen.findByText(/this page changes by itself/);
    await u.keyboard('{Escape}');
    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText('Leave this payment?')).toBeInTheDocument();
    await u.click(within(confirm).getByRole('button', { name: 'Stay' }));
    expect(useApp.getState().route).toEqual({ name: 'plans', from: 'settings' });
    await u.keyboard('{Escape}');
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave' }));
    expect(useApp.getState().route).toEqual({ name: 'settings' });
  });

  it('Cancel leaves without asking the API anything', async () => {
    const u = await toPayStep();
    await u.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useApp.getState().route).toEqual({ name: 'settings' });
    expect(billing.billingCheckout).not.toHaveBeenCalled();
  });
});

describe('plans screen: done', () => {
  async function payAndSucceed() {
    const u = await toPayStep();
    await u.click(screen.getByRole('button', { name: 'Open the QRIS page' }));
    await screen.findByText(/this page changes by itself/);
    vi.mocked(billing.billingStatus).mockResolvedValue(creator);
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    return u;
  }

  it('the paid plan, until when, what it unlocks, confetti, and the way on', async () => {
    const u = await payAndSucceed();
    expect(await screen.findByRole('heading', { level: 1, name: 'Creator plan active' })).toHaveFocus();
    expect(screen.getByText('Until Dec 4, 2026')).toBeInTheDocument();
    expect(screen.getByText('60 AI images a month')).toBeInTheDocument();
    expect(fireConfetti).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-static-celebration]')).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Start making a video' }));
    expect(useApp.getState().route).toEqual({ name: 'chat-new' });
  });

  it('no confetti under reduced motion: a still picture instead', async () => {
    vi.mocked(prefersReducedMotion).mockReturnValue(true);
    await payAndSucceed();
    expect(await screen.findByRole('heading', { level: 1, name: 'Creator plan active' })).toBeInTheDocument();
    expect(fireConfetti).not.toHaveBeenCalled();
    expect(document.querySelector('[data-static-celebration]')).not.toBeNull();
  });

  it('notifies when the window is not in front', async () => {
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    try {
      await payAndSucceed();
      await screen.findByRole('heading', { level: 1, name: 'Creator plan active' });
      await vi.waitFor(() => expect(show).toHaveBeenCalledWith('Creator plan active'));
    } finally {
      focus.mockRestore();
    }
  });

  it('in Indonesian', async () => {
    setUiLanguage('id');
    vi.mocked(billing.billingStatus).mockResolvedValue(free);
    const u = user();
    render(<Plans from="settings" />);
    await u.click(await screen.findByRole('radio', { name: 'Creator' }));
    await u.click(screen.getByRole('button', { name: 'Lanjut bayar' }));
    await u.click(await screen.findByRole('button', { name: 'Buka halaman QRIS' }));
    expect(await screen.findByText(/halaman ini berubah sendiri begitu pembayaranmu masuk/)).toBeInTheDocument();
    vi.mocked(billing.billingStatus).mockResolvedValue(creator);
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(await screen.findByRole('heading', { level: 1, name: 'Paket Creator aktif' })).toBeInTheDocument();
    expect(screen.getByText('Sampai 4 Des 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mulai bikin video' })).toBeInTheDocument();
  });
});

describe('clock', () => {
  it('minutes and seconds, hours when needed', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65_000)).toBe('1:05');
    expect(clock(3_723_000)).toBe('1:02:03');
    expect(clock(-5)).toBe('0:00');
  });
});
