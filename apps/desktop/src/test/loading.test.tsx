import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { Project, SocialAccount, UsageResponse } from '@tayang/shared';

vi.mock('@/lib/cloud', async (orig) => {
  const real = await orig<typeof import('@/lib/cloud')>();
  return {
    ...real,
    cloudUsage: vi.fn(),
    socialAccounts: vi.fn(),
    socialConnect: vi.fn(),
    socialDisconnect: vi.fn(),
    socialPostStatus: vi.fn(),
    redeemGiftCode: vi.fn(),
  };
});
vi.mock('@/lib/ipc', () => ({ listProjects: vi.fn(), videoThumbnail: vi.fn().mockResolvedValue(null), assetUrl: (p: string) => p }));
vi.mock('@/lib/auth', () => ({
  authStatus: vi.fn(async () => null),
  onAuthChanged: vi.fn(async () => () => {}),
  authStart: vi.fn(),
  authCancel: vi.fn(),
  authLogout: vi.fn(),
  authErrorCode: vi.fn(),
}));

import * as cloud from '@/lib/cloud';
import { listProjects } from '@/lib/ipc';
import { SocialAccounts } from '@/components/SocialAccounts';
import { GiftCode } from '@/components/GiftCode';
import { TayangCreditsCompact } from '@/components/UsageBar';
import { Social } from '@/screens/Social';
import { useApp } from '@/state/app';
import { useAuth } from '@/state/auth';
import { useTayangUsage } from '@/state/tayangUsage';

/** A promise the test settles when it wants, so the in-between state can be looked at. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const usage: UsageResponse = {
  plan: 'creator',
  cycleStart: '2026-11-01T00:00:00.000Z',
  cycleEnd: '2026-12-01T00:00:00.000Z',
  credits: { allowance: 165, used: 0, remaining: 165 },
  posts: { allowance: 90, used: 0, remaining: 90 },
};
const acct: SocialAccount = { id: 'sa_1', platform: 'tiktok', username: 'oyen', profilePhotoUrl: null, status: 'connected' };

beforeEach(() => {
  vi.clearAllMocks();
  useTayangUsage.getState().clear();
  useApp.setState({ route: { name: 'settings' }, leaveGuard: null, projectsVersion: 0 } as never);
  useAuth.setState({ status: { state: 'signed-in', signedIn: true, apiUrl: 'x', account: { id: 'a', email: 'e', name: 'n', plan: 'creator' } } as never });
});

describe('loading states while the API answers', () => {
  it('social accounts: placeholders, then the list; the refresh turns while it loads', async () => {
    const list = deferred<SocialAccount[]>();
    vi.mocked(cloud.cloudUsage).mockResolvedValue(usage);
    vi.mocked(cloud.socialAccounts).mockReturnValue(list.promise);
    render(<SocialAccounts />);
    expect(await screen.findByRole('status', { name: 'Loading your social accounts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    list.resolve([acct]);
    expect(await screen.findByText('@oyen')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading your social accounts' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  it('connecting says it is opening the platform until the browser opens', async () => {
    const open = deferred<void>();
    vi.mocked(cloud.cloudUsage).mockResolvedValue(usage);
    vi.mocked(cloud.socialAccounts).mockResolvedValue([]);
    vi.mocked(cloud.socialConnect).mockReturnValue(open.promise);
    render(<SocialAccounts />);
    await screen.findByText(/No accounts yet/);
    await userEvent.click(screen.getByRole('button', { name: 'Connect account' }));
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'TikTok' }));
    const button = await screen.findByRole('button', { name: 'Opening TikTok…' });
    expect(button).toBeDisabled();
    expect(within(button).getByTestId('spinner')).toBeInTheDocument();
    open.resolve();
    expect(await screen.findByText(/Finish connecting TikTok in your browser/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect account' })).toBeEnabled();
  });

  it('disconnecting shows on that account until it is gone', async () => {
    const gone = deferred<void>();
    vi.mocked(cloud.cloudUsage).mockResolvedValue(usage);
    vi.mocked(cloud.socialAccounts).mockResolvedValue([acct]);
    vi.mocked(cloud.socialDisconnect).mockReturnValue(gone.promise);
    render(<SocialAccounts />);
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect oyen' }));
    expect(screen.getByRole('button', { name: 'Disconnect oyen' })).toHaveTextContent('Disconnecting…');
    expect(screen.getByRole('button', { name: 'Disconnect oyen' })).toBeDisabled();
    gone.resolve();
    await waitFor(() => expect(screen.queryByText('@oyen')).toBeNull());
  });

  it('the social screen holds rows for the posts, and each post checks its status', async () => {
    const projects = deferred<Project[]>();
    const status = deferred<never>();
    vi.mocked(listProjects).mockReturnValue(projects.promise);
    vi.mocked(cloud.cloudUsage).mockResolvedValue(usage);
    vi.mocked(cloud.socialAccounts).mockResolvedValue([]);
    vi.mocked(cloud.socialPostStatus).mockReturnValue(status.promise);
    render(<Social />);
    expect(await screen.findByRole('status', { name: 'Loading your posts' })).toBeInTheDocument();
    projects.resolve([{ id: 'p1', title: 'Pelangi', socialPostId: 'sp_1', postedAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z' } as Project]);
    expect(await screen.findByText('Pelangi')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Checking how it went' })).toBeInTheDocument();
    status.reject('cloud:network');
    expect(await screen.findByText("Couldn't check")).toBeInTheDocument();
  });

  it('the credits in the status bar hold their place until they arrive', async () => {
    const u = deferred<UsageResponse>();
    vi.mocked(cloud.cloudUsage).mockReturnValue(u.promise);
    render(<TayangCreditsCompact />);
    expect(screen.getByRole('status', { name: 'Tayang credits' })).toBeInTheDocument();
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    u.resolve(usage);
    expect(await screen.findByRole('button', { name: 'Tayang credits: 165 credits · 90 posts' })).toBeInTheDocument();
  });

  it('redeeming a gift code turns in its button', async () => {
    const r = deferred<never>();
    vi.mocked(cloud.redeemGiftCode).mockReturnValue(r.promise);
    render(<GiftCode />);
    await userEvent.type(screen.getByLabelText('Have a gift code?'), 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: 'Redeem' }));
    const busy = screen.getByRole('button', { name: 'Redeeming…' });
    expect(busy).toBeDisabled();
    expect(within(busy).getByTestId('spinner')).toBeInTheDocument();
    r.reject('cloud:invalid-code');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Redeem' })).toBeEnabled();
  });
});
