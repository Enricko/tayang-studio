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
    socialPost: vi.fn(),
    socialPostStatus: vi.fn(),
  };
});
vi.mock('@/lib/ipc', () => ({ listProjects: vi.fn().mockResolvedValue([]), videoThumbnail: vi.fn().mockResolvedValue(null), assetUrl: (p: string) => p }));
vi.mock('@/lib/auth', () => ({
  authStatus: vi.fn(async () => null),
  onAuthChanged: vi.fn(async () => () => {}),
  authStart: vi.fn(),
  authCancel: vi.fn(),
  authLogout: vi.fn(),
  authErrorCode: vi.fn(),
}));

import * as cloud from '@/lib/cloud';
import { cloudErrorCode } from '@/lib/cloud';
import { SocialAccounts } from '@/components/SocialAccounts';
import { PostDialog } from '@/components/PostDialog';
import { Social } from '@/screens/Social';
import { UsageTab } from '@/components/UsageTab';
import { listProjects } from '@/lib/ipc';
import { useApp } from '@/state/app';
import { useAuth } from '@/state/auth';

const usage = (posts: number, credits = 165): UsageResponse => ({
  plan: 'creator',
  cycleStart: '2026-11-01T00:00:00.000Z',
  cycleEnd: '2026-12-01T00:00:00.000Z',
  credits: { allowance: credits, used: 0, remaining: credits },
  posts: { allowance: posts, used: 4, remaining: Math.max(0, posts - 4) },
});
const acct = (id: string, platform: string, username: string | null, status: SocialAccount['status'] = 'connected'): SocialAccount => ({
  id,
  platform,
  username,
  profilePhotoUrl: null,
  status,
});
const project: Project = {
  id: 'p1',
  title: 'Kenapa pelangi melengkung',
  slug: 'p1',
  folder: '/w/p1',
  kind: 'explainer',
  format: '9:16',
  language: 'id',
  status: 'rendered',
  styleId: null,
  scheduledAt: null,
  reviewState: 'none',
  postedAt: null,
  remindedAt: null,
  reviewRemindedAt: null,
  durationSec: 5,
  createdAt: '',
  updatedAt: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.setState({ status: { state: 'signed-in', signedIn: true, apiUrl: 'x', account: { id: 'a', email: 'e', name: 'n', plan: 'creator' } } as never });
  useApp.setState({ route: { name: 'settings' }, leaveGuard: null });
});

describe('cloudErrorCode', () => {
  it('reads the Rust error codes', () => {
    expect(cloudErrorCode('cloud:plan-required')).toBe('plan-required');
    expect(cloudErrorCode(new Error('cloud:quota-exceeded'))).toBe('quota-exceeded');
    expect(cloudErrorCode('cloud:made-up')).toBe('other');
    expect(cloudErrorCode('boom')).toBe('other');
  });
});

describe('SocialAccounts in Settings', () => {
  it('shows the auto-posts left and the connected accounts, and disconnects one', async () => {
    vi.mocked(cloud.cloudUsage).mockResolvedValue(usage(90));
    vi.mocked(cloud.socialAccounts).mockResolvedValue([acct('sa_1', 'tiktok', 'oyen'), acct('sa_2', 'youtube', null, 'disconnected')]);
    vi.mocked(cloud.socialDisconnect).mockResolvedValue();
    render(<SocialAccounts />);
    expect(await screen.findByText('@oyen')).toBeInTheDocument();
    expect(screen.getByText('86 auto-posts left this month')).toBeInTheDocument();
    // Credits are in Settings › Usage now.
    expect(screen.queryByText('165 of 165 left')).not.toBeInTheDocument();
    expect(screen.getByText('Reconnect')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect oyen' }));
    expect(cloud.socialDisconnect).toHaveBeenCalledWith('sa_1');
    await waitFor(() => expect(screen.queryByText('@oyen')).not.toBeInTheDocument());
  });

  it('connecting opens the platform in the browser and says to finish there', async () => {
    vi.mocked(cloud.cloudUsage).mockResolvedValue(usage(90));
    vi.mocked(cloud.socialAccounts).mockResolvedValue([]);
    vi.mocked(cloud.socialConnect).mockResolvedValue();
    render(<SocialAccounts />);
    expect(await screen.findByText(/No accounts yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Connect account' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'TikTok', 'TikTok Business', 'Instagram', 'YouTube', 'Facebook', 'Threads',
    ]);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'TikTok' }));
    expect(cloud.socialConnect).toHaveBeenCalledWith('tiktok');
    expect(await screen.findByText(/Finish connecting TikTok in your browser/)).toBeInTheDocument();
  });

  it('a plan without auto-posts can still connect, and points to the plans for posting', async () => {
    vi.mocked(cloud.cloudUsage).mockResolvedValue(usage(0, 0));
    vi.mocked(cloud.socialAccounts).mockResolvedValue([acct('sa_1', 'tiktok', 'oyen')]);
    vi.mocked(cloud.socialConnect).mockResolvedValue();
    render(<SocialAccounts />);
    expect(await screen.findByText('You can connect accounts now. Posting to them comes with a Tayang plan.')).toBeInTheDocument();
    expect(screen.getByText('@oyen')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Connect account' }));
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Instagram' }));
    expect(cloud.socialConnect).toHaveBeenCalledWith('instagram');
    await userEvent.click(screen.getByRole('button', { name: 'See plans' }));
    expect(useApp.getState().route).toEqual({ name: 'plans', from: 'settings' });
  });

  it('is not shown signed out', () => {
    useAuth.setState({ status: { state: 'signed-out', signedIn: false } as never });
    const { container } = render(<SocialAccounts />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PostDialog', () => {
  const open = (p: Project = project) => render(<PostDialog open onOpenChange={() => {}} project={p} onPosted={() => {}} />);

  it('posts the video to the picked accounts and shows how it went', async () => {
    vi.mocked(cloud.socialAccounts).mockResolvedValue([acct('sa_1', 'tiktok', 'oyen'), acct('sa_2', 'instagram', 'oyen.ig'), acct('sa_3', 'x', 'off', 'disconnected')]);
    vi.mocked(cloud.socialPost).mockResolvedValue({ postId: 'sp_1', status: 'processing', postsCharged: 1, usage: { allowance: 90, used: 5, remaining: 85 } });
    vi.mocked(cloud.socialPostStatus).mockResolvedValue({
      postId: 'sp_1',
      status: 'processed',
      scheduledAt: null,
      results: [{ socialAccountId: 'sa_1', success: true, error: null, url: 'https://tiktok.com/@oyen/video/1' }],
    });
    open();
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('@oyen.ig')).toBeInTheDocument();
    // A disconnected account can't be picked.
    expect(within(dialog).queryByText('@off')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Uses 2 auto-posts, one per account.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getAllByRole('checkbox')[1]!);
    expect(within(dialog).getByText('Uses 1 auto-post.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Post now' }));
    const call = vi.mocked(cloud.socialPost).mock.calls[0]![0];
    expect(call).toMatchObject({ projectId: 'p1', caption: 'Kenapa pelangi melengkung', accountIds: ['sa_1'], scheduledAt: null });
    expect(await within(dialog).findByText('Posted to 1 account.')).toBeInTheDocument();
    expect(within(dialog).getByText('85 auto-posts left this month.')).toBeInTheDocument();
    expect(await within(dialog).findByRole('link', { name: /Open/ })).toHaveAttribute('href', 'https://tiktok.com/@oyen/video/1');
  });

  it('retries with the same request id after an error, and a plan error points to the plans', async () => {
    vi.mocked(cloud.socialAccounts).mockResolvedValue([acct('sa_1', 'tiktok', 'oyen')]);
    vi.mocked(cloud.socialPost).mockRejectedValueOnce('cloud:network').mockRejectedValueOnce('cloud:quota-exceeded');
    open();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Post now' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Couldn't reach Tayang");
    await userEvent.click(within(dialog).getByRole('button', { name: 'Post now' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("You've used this month's allowance.");
    const [first, second] = vi.mocked(cloud.socialPost).mock.calls.map((c) => c[0].clientRequestId);
    expect(first).toBe(second);
    expect(within(dialog).getByRole('button', { name: 'See plans' })).toBeInTheDocument();
  });

  it('schedules for later with the time picked', async () => {
    vi.mocked(cloud.socialAccounts).mockResolvedValue([acct('sa_1', 'tiktok', 'oyen')]);
    vi.mocked(cloud.socialPost).mockResolvedValue({ postId: 'sp_2', status: 'scheduled', postsCharged: 1, usage: { allowance: 90, used: 5, remaining: 85 } });
    vi.mocked(cloud.socialPostStatus).mockResolvedValue({ postId: 'sp_2', status: 'scheduled', scheduledAt: null, results: [] });
    open();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByText('Schedule for later'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect(vi.mocked(cloud.socialPost).mock.calls[0]![0].scheduledAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(await within(dialog).findByText('Scheduled for 1 account.')).toBeInTheDocument();
  });

  it('with no accounts, sends the user to connect one', async () => {
    vi.mocked(cloud.socialAccounts).mockResolvedValue([]);
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Connect an account' }));
    expect(useApp.getState().route).toEqual({ name: 'settings' });
  });
});

describe('Social media screen', () => {
  it('signed out, offers to sign in instead of the accounts', () => {
    useAuth.setState({ status: { state: 'signed-out', signedIn: false } as never, flow: { phase: 'closed' } });
    render(<Social />);
    expect(screen.getByRole('heading', { name: 'Social media' })).toBeInTheDocument();
    expect(screen.getByText('Post your videos from Tayang')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
    expect(cloud.socialAccounts).not.toHaveBeenCalled();
  });

  it('shows the accounts and every posted video with how it went', async () => {
    vi.mocked(cloud.cloudUsage).mockResolvedValue(usage(90));
    vi.mocked(cloud.socialAccounts).mockResolvedValue([acct('sa_1', 'tiktok', 'oyen')]);
    vi.mocked(listProjects).mockResolvedValue([
      { ...project, id: 'p1', title: 'Pelangi', socialPostId: 'sp_1', postedAt: '2026-11-05T10:00:00.000Z' },
      { ...project, id: 'p2', title: 'Belum diposting' },
    ]);
    vi.mocked(cloud.socialPostStatus).mockResolvedValue({
      postId: 'sp_1',
      status: 'processed',
      scheduledAt: null,
      results: [
        { socialAccountId: 'sa_1', success: true, error: null, url: 'https://tiktok.com/@oyen/video/1' },
        { socialAccountId: 'sa_2', success: false, error: 'video too long', url: null },
      ],
    });
    render(<Social />);
    expect(await screen.findByText('@oyen')).toBeInTheDocument();
    const posts = await screen.findByRole('list', { name: 'Posts' });
    expect(within(posts).getByText('Pelangi')).toBeInTheDocument();
    expect(within(posts).queryByText('Belum diposting')).not.toBeInTheDocument();
    expect(await within(posts).findByText('1 posted')).toBeInTheDocument();
    expect(within(posts).getByText('1 failed')).toBeInTheDocument();
    expect(within(posts).getByRole('link', { name: 'Open the post of Pelangi' })).toHaveAttribute('href', 'https://tiktok.com/@oyen/video/1');
  });

  it('says so when nothing was posted yet', async () => {
    vi.mocked(cloud.cloudUsage).mockResolvedValue(usage(90));
    vi.mocked(cloud.socialAccounts).mockResolvedValue([]);
    vi.mocked(listProjects).mockResolvedValue([project]);
    render(<Social />);
    expect(await screen.findByText(/Nothing posted yet/)).toBeInTheDocument();
  });
});

describe('Settings › Usage', () => {
  it('shows the plan\'s credits and auto-posts with meters', async () => {
    vi.mocked(cloud.cloudUsage).mockResolvedValue(usage(90));
    render(<UsageTab onAccount={() => {}} />);
    expect(await screen.findByText('86 of 90 left')).toBeInTheDocument();
    expect(screen.getByText('165 of 165 left')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Auto-posts' })).toHaveAttribute('aria-valuenow', '4');
    expect(screen.getByText('Your agents')).toBeInTheDocument();
  });

  it('signed out, points to the Account tab', async () => {
    useAuth.setState({ status: { state: 'signed-out', signedIn: false } as never });
    const onAccount = vi.fn();
    render(<UsageTab onAccount={onAccount} />);
    await userEvent.click(screen.getByRole('button', { name: 'Go to Account' }));
    expect(onAccount).toHaveBeenCalled();
    expect(cloud.cloudUsage).not.toHaveBeenCalled();
  });
});
