import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingStatus } from '@tayang/shared';

vi.mock('@/lib/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing')>()),
  billingCheckout: vi.fn(),
  billingStatus: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));

import { openUrl } from '@tauri-apps/plugin-opener';
import { PlanCard } from '@/components/Plan';
import { setUiLanguage } from '@/i18n';
import * as billing from '@/lib/billing';
import { POLL_MS } from '@/lib/billing';
import { useBilling } from '@/state/billing';

const free: BillingStatus = { plan: 'free', lastPlan: null, currentPeriodEnd: null, active: false, pending: null };
const creator: BillingStatus = { plan: 'creator', lastPlan: 'creator', currentPeriodEnd: '2026-12-04T12:00:00.000Z', active: true, pending: null };
const checkout = { orderId: 'TYG-A', paymentLinkUrl: 'https://pay.sumopod.com/p/1', expiresAt: '2026-11-04T13:00:00.000Z', amount: 50000 };

beforeEach(() => {
  vi.clearAllMocks();
  useBilling.getState().reset();
  vi.mocked(billing.billingStatus).mockResolvedValue(free);
  vi.mocked(billing.billingCheckout).mockResolvedValue(checkout);
});

describe('plan card', () => {
  it('free: says so and offers Upgrade', async () => {
    render(<PlanCard />);
    expect(await screen.findByText('Free')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Renew' })).not.toBeInTheDocument();
  });

  it('paid: the plan, until when, Renew and Change plan', async () => {
    vi.mocked(billing.billingStatus).mockResolvedValue(creator);
    render(<PlanCard />);
    expect(await screen.findByText('Creator')).toBeInTheDocument();
    expect(screen.getByText('Active until Dec 4, 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Renew' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change plan' })).toBeInTheDocument();
  });

  it('ended: says Ended and offers Renew', async () => {
    vi.mocked(billing.billingStatus).mockResolvedValue({ ...creator, plan: 'free', active: false });
    render(<PlanCard />);
    expect(await screen.findByText('Ended on Dec 4, 2026')).toBeInTheDocument();
    expect(screen.getByText('Creator')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Renew' })).toBeInTheDocument();
  });

  it('in Indonesian', async () => {
    setUiLanguage('id');
    vi.mocked(billing.billingStatus).mockResolvedValue(creator);
    render(<PlanCard />);
    expect(await screen.findByText('Aktif sampai 4 Des 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Perpanjang' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ganti paket' })).toBeInTheDocument();
  });

  it('offers to continue a payment that is still waiting', async () => {
    vi.mocked(billing.billingStatus).mockResolvedValue({
      ...free,
      pending: { orderId: 'TYG-A', plan: 'pro', paymentLinkUrl: checkout.paymentLinkUrl, expiresAt: checkout.expiresAt },
    });
    render(<PlanCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Continue payment' }));
    expect(billing.billingCheckout).toHaveBeenCalledWith('pro');
    expect(await screen.findByText('Finish paying in your browser')).toBeInTheDocument();
  });
});

describe('plan dialog', () => {
  it('shows the three plans with monthly prices and marks the current one', async () => {
    vi.mocked(billing.billingStatus).mockResolvedValue(creator);
    render(<PlanCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Change plan' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Rp15,000/month')).toBeInTheDocument();
    expect(within(dialog).getByText('Rp50,000/month')).toBeInTheDocument();
    expect(within(dialog).getByText('Rp90,000/month')).toBeInTheDocument();
    expect(within(dialog).getByText('150 auto-posts a month')).toBeInTheDocument();
    expect(within(dialog).getByText('Current plan')).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Creator' })).toBeChecked();
  });

  it('prices in Indonesian', async () => {
    setUiLanguage('id');
    render(<PlanCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Upgrade' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Rp15.000/bulan')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Bayar dengan QRIS' })).toBeInTheDocument();
  });

  it('pays with QRIS, waits, opens the page again, and shows the plan once it is paid', async () => {
    render(<PlanCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Upgrade' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Creator' }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await userEvent.click(within(dialog).getByRole('button', { name: 'Pay with QRIS' }));
      expect(billing.billingCheckout).toHaveBeenCalledWith('creator');
      expect(await screen.findByText('Finish paying in your browser')).toBeInTheDocument();
      expect(screen.getByText('Waiting for the payment…')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Open again' }));
      expect(openUrl).toHaveBeenCalledWith(checkout.paymentLinkUrl);
      vi.mocked(billing.billingStatus).mockResolvedValue(creator);
      await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
      expect(await screen.findByText('Creator plan active until Dec 4, 2026')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says payments are not available yet when billing is off (I2)', async () => {
    setUiLanguage('id');
    vi.mocked(billing.billingCheckout).mockRejectedValueOnce('billing:unavailable');
    render(<PlanCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Upgrade' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bayar dengan QRIS' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pembayaran belum tersedia');
  });

  it('Open again never opens a link off the payment hosts (M5)', async () => {
    render(<PlanCard />);
    await screen.findByText('Free');
    act(() =>
      useBilling.setState({
        flow: { phase: 'waiting', plan: 'lite', checkout: { ...checkout, paymentLinkUrl: 'https://pay.example/p/1' }, endBefore: null },
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Open again' }));
    expect(openUrl).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent("isn't SumoPod's");
  });

  it('shows a failed checkout and lets you try again', async () => {
    vi.mocked(billing.billingCheckout).mockRejectedValueOnce('billing:payment-provider');
    render(<PlanCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Upgrade' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Pay with QRIS' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("The payment service isn't answering right now");
    await userEvent.click(screen.getByRole('button', { name: 'Pay with QRIS' }));
    expect(await screen.findByText('Finish paying in your browser')).toBeInTheDocument();
  });
});
