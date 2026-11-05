import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { UsageResponse } from '@tayang/shared';

vi.mock('@/lib/cloud', async (orig) => {
  const real = await orig<typeof import('@/lib/cloud')>();
  return { ...real, cloudUsage: vi.fn(), redeemGiftCode: vi.fn() };
});
vi.mock('@/lib/auth', () => ({
  authStatus: vi.fn(async () => null),
  onAuthChanged: vi.fn(async () => () => {}),
  authStart: vi.fn(),
  authCancel: vi.fn(),
  authLogout: vi.fn(),
  authErrorCode: vi.fn(),
}));

import * as cloud from '@/lib/cloud';
import { GiftCode } from '@/components/GiftCode';
import { TayangCreditsCompact } from '@/components/UsageBar';
import { UsageTab } from '@/components/UsageTab';
import { useApp } from '@/state/app';
import { useAuth } from '@/state/auth';
import { useTayangUsage } from '@/state/tayangUsage';

const usage = (o: Partial<UsageResponse> = {}): UsageResponse => ({
  plan: 'free',
  cycleStart: '2026-11-01T00:00:00.000Z',
  cycleEnd: '2026-12-01T00:00:00.000Z',
  credits: { allowance: 14, used: 2, remaining: 12 },
  posts: { allowance: 5, used: 0, remaining: 5 },
  gifts: [{ name: 'Launch gift', credits: 14, posts: 5, creditsLeft: 12, postsLeft: 5, expiresAt: '2026-12-10T00:00:00.000Z' }],
  ...o,
});
const signIn = () =>
  useAuth.setState({ status: { state: 'signed-in', signedIn: true, apiUrl: 'x', account: { id: 'a', email: 'e', name: 'n', plan: 'free' } } as never });

beforeEach(() => {
  vi.clearAllMocks();
  useTayangUsage.getState().clear();
  useApp.setState({ route: { name: 'settings' }, leaveGuard: null });
  signIn();
});

describe('GiftCode', () => {
  it('redeems a code, says what was added and until when, and refreshes the credits', async () => {
    vi.mocked(cloud.redeemGiftCode).mockResolvedValue({
      gift: { name: 'Launch gift', credits: 14, posts: 5, creditsLeft: 14, postsLeft: 5, expiresAt: '2026-12-10T00:00:00.000Z' },
    });
    vi.mocked(cloud.cloudUsage).mockResolvedValue(usage());
    render(<GiftCode />);
    const redeem = screen.getByRole('button', { name: 'Redeem' });
    expect(redeem).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Have a gift code?'), 'abcd-efgh-jkmn');
    await userEvent.click(redeem);
    expect(cloud.redeemGiftCode).toHaveBeenCalledWith('abcd-efgh-jkmn');
    expect(await screen.findByRole('status')).toHaveTextContent('Added 14 AI credits and 5 auto-posts to your account, until Dec 10, 2026.');
    expect(screen.getByLabelText('Have a gift code?')).toHaveValue('');
    await waitFor(() => expect(useTayangUsage.getState().usage?.credits.remaining).toBe(12));
  });

  it.each([
    ['cloud:invalid-code', "That code doesn't exist. Check it and try again."],
    ['cloud:code-used', 'This code has already been used.'],
    ['cloud:already-redeemed', "You've already redeemed a code from this promo."],
    ['cloud:device-used', 'A code from this promo was already redeemed on this computer.'],
    ['cloud:code-expired', 'This promo has ended.'],
    ['cloud:rate-limited', 'Too many tries. Wait an hour, then try again.'],
  ])('explains %s', async (err, text) => {
    vi.mocked(cloud.redeemGiftCode).mockRejectedValue(err);
    render(<GiftCode />);
    await userEvent.type(screen.getByLabelText('Have a gift code?'), 'WRONG');
    await userEvent.click(screen.getByRole('button', { name: 'Redeem' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('is not shown signed out', () => {
    useAuth.setState({ status: { state: 'signed-out', signedIn: false } as never });
    const { container } = render(<GiftCode />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Tayang credits in the sidebar', () => {
  it('shows the credits and posts left and opens Settings › Usage', async () => {
    vi.mocked(cloud.cloudUsage).mockResolvedValue(usage());
    render(<TayangCreditsCompact />);
    const row = await screen.findByRole('button', { name: 'Tayang credits: 12 credits · 5 posts' });
    await userEvent.click(row);
    expect(useApp.getState().route).toEqual({ name: 'settings', tab: 'usage' });
  });

  it('shows nothing signed out, and asks for nothing', () => {
    useAuth.setState({ status: { state: 'signed-out', signedIn: false } as never });
    const { container } = render(<TayangCreditsCompact />);
    expect(container).toBeEmptyDOMElement();
    expect(cloud.cloudUsage).not.toHaveBeenCalled();
  });
});

describe('Settings › Usage lists running gifts', () => {
  it('with what is left of each', async () => {
    vi.mocked(cloud.cloudUsage).mockResolvedValue(
      usage({ gifts: [{ name: 'Launch gift', credits: 14, posts: 5, creditsLeft: 0, postsLeft: 3, expiresAt: '2026-12-10T00:00:00.000Z' }] }),
    );
    render(<UsageTab onAccount={() => {}} />);
    expect(await screen.findByText('Launch gift: 0 AI credits and 3 auto-posts left, until Dec 10, 2026')).toBeInTheDocument();
  });
});
