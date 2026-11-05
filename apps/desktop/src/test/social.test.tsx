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
vi.mock('@/lib/ipc', () => ({ listProjects: vi.fn().mockResolvedValue([]) }));

import * as cloud from '@/lib/cloud';
import { cloudErrorCode } from '@/lib/cloud';
import { SocialAccounts } from '@/components/SocialAccounts';
import { PostDialog } from '@/components/PostDialog';
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
  it('shows credits and auto-posts left and the connected accounts, and disconnects one', async () => {
    vi.mocked(cloud.cloudUsage).mockResolvedValue(usage(90));
    vi.mocked(cloud.socialAccounts).mockResolvedValue([acct('sa_1', 'tiktok', 'oyen'), acct('sa_2', 'youtube', null, 'disconnected')]);
    vi.mocked(cloud.socialDisconnect).mockResolvedValue();
    render(<SocialAccounts />);
    expect(await screen.findByText('@oyen')).toBeInTheDocument();
    expect(screen.getByText('165 of 165 left')).toBeInTheDocument();
    expect(screen.getByText('86 of 90 left')).toBeInTheDocument();
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
    await userEvent.click(await screen.findByRole('menuitem', { name: 'TikTok' }));
    expect(cloud.socialConnect).toHaveBeenCalledWith('tiktok');
    expect(await screen.findByText(/Finish connecting TikTok in your browser/)).toBeInTheDocument();
  });

  it('a plan without auto-posts points to the plans', async () => {
    vi.mocked(cloud.cloudUsage).mockResolvedValue(usage(0, 0));
    vi.mocked(cloud.socialAccounts).mockResolvedValue([]);
    render(<SocialAccounts />);
    await userEvent.click(await screen.findByRole('button', { name: 'See plans' }));
    expect(useApp.getState().route).toEqual({ name: 'plans', from: 'settings' });
    expect(screen.queryByRole('button', { name: 'Connect account' })).not.toBeInTheDocument();
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
