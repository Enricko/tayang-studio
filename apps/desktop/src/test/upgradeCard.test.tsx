import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingStatus } from '@tayang/shared';

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import { lacksVoice, UpgradeCard } from '@/components/UpgradeCard';
import { useApp } from '@/state/app';
import { useAuth } from '@/state/auth';
import { useBilling } from '@/state/billing';

const plan = (p: BillingStatus['plan'], active = true) =>
  ({ plan: p, lastPlan: null, currentPeriodEnd: null, active, pending: null, lastPaidOrderId: null }) as BillingStatus;

beforeEach(() => {
  localStorage.clear();
  useAuth.setState({ status: { signedIn: true, state: 'signedIn', offline: false, apiUrl: '' } as never });
  useBilling.setState({ status: plan('free'), loadedAt: 1, failed: false });
});

describe('UpgradeCard', () => {
  it('is for users without AI voice-overs: free, Lite, or a plan that ran out', () => {
    expect(lacksVoice(plan('free'))).toBe(true);
    expect(lacksVoice(plan('lite'))).toBe(true);
    expect(lacksVoice(plan('creator', false))).toBe(true);
    expect(lacksVoice(plan('creator'))).toBe(false);
    expect(lacksVoice(plan('pro'))).toBe(false);
  });

  it('opens the Creator plan, and hides for a paying user or while the plan is unknown', async () => {
    const navigate = vi.fn();
    useApp.setState({ navigate } as never);
    const { rerender } = render(<UpgradeCard where="sidebar" />);
    expect(screen.getByText('Get ElevenLabs voices & cheap AI images')).toBeInTheDocument();
    expect(screen.getByText(/from Rp50/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'See plans' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'plans', plan: 'creator' });

    useBilling.setState({ status: plan('pro') });
    rerender(<UpgradeCard where="sidebar" />);
    expect(screen.queryByRole('button', { name: 'See plans' })).toBeNull();

    useBilling.setState({ status: null, loadedAt: 1, failed: true });
    rerender(<UpgradeCard where="sidebar" />);
    expect(screen.queryByRole('button', { name: 'See plans' })).toBeNull();
  });

  it('stays hidden for a week after Close', async () => {
    const { unmount } = render(<UpgradeCard where="calendar" />);
    await userEvent.click(screen.getByRole('button', { name: 'Hide for a week' }));
    expect(screen.queryByRole('button', { name: 'See plans' })).toBeNull();
    unmount();
    render(<UpgradeCard where="calendar" />);
    expect(screen.queryByRole('button', { name: 'See plans' })).toBeNull();
  });
});
