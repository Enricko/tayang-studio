import { act, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import type { Project } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  assetUrl: (p: string) => `asset://${p}`,
  videoThumbnail: vi.fn(),
  listProjects: vi.fn(),
  listChats: vi.fn().mockResolvedValue([]),
  createChat: vi.fn(),
}));
vi.mock('@/lib/events', () => ({
  onQuestion: vi.fn(async () => () => {}),
  onAgentAction: vi.fn(async () => () => {}), onAgentUpdate: vi.fn(async () => () => {}), onPermission: vi.fn(async () => () => {}) }));

import { listProjects, videoThumbnail } from '@/lib/ipc';
import { Videos } from '@/screens/Videos';
import { VideoPoster } from '@/components/VideoPoster';
import { setUiLanguage } from '@/i18n';
import { useRender } from '@/state/render';
import { useApp } from '@/state/app';

const proj = (over: Partial<Project> = {}): Project => ({
  id: 'p1', title: 'Jalur Rempah', slug: 'p1', folder: '/w/p1', kind: 'explainer', format: '9:16', language: 'id', status: 'rendered',
  styleId: null, scheduledAt: null, reviewState: 'none', postedAt: null, remindedAt: null, reviewRemindedAt: null,
  durationSec: null, createdAt: 'c', updatedAt: new Date().toISOString(), ...over,
});
const thumb = { path: '/data/thumbs/p1-1800000000000.jpg', modifiedAt: '2027-01-15T08:00:00.000Z', durationSec: 66 };

beforeEach(() => {
  vi.clearAllMocks();
  useRender.setState({ runs: {} });
});

describe('the Videos card poster', () => {
  it('shows a frame of the render, cover-fitted, lazy, with the duration', async () => {
    vi.mocked(videoThumbnail).mockResolvedValue(thumb);
    render(<VideoPoster project={proj()} />);
    const img = await screen.findByTestId('video-thumb');
    expect(img).toHaveAttribute('src', `asset:///data/thumbs/p1-1800000000000.jpg?v=${encodeURIComponent(thumb.modifiedAt)}`);
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveClass('object-cover');
    expect(videoThumbnail).toHaveBeenCalledWith('p1');
    expect(screen.getByText('1:06')).toBeInTheDocument();
    expect(screen.queryByText('No preview yet')).toBeNull();
  });

  it("uses the project's own length when the thumbnail has none, and shows none without either", async () => {
    vi.mocked(videoThumbnail).mockResolvedValue({ ...thumb, durationSec: null });
    const { unmount } = render(<VideoPoster project={proj({ durationSec: 42 })} />);
    expect(await screen.findByText('0:42')).toBeInTheDocument();
    unmount();
    render(<VideoPoster project={proj()} />);
    await screen.findByTestId('video-thumb');
    expect(screen.queryByText(/^\d+:\d\d$/)).toBeNull();
  });

  it('without a render: the calm no-preview panel, no title poster', async () => {
    vi.mocked(videoThumbnail).mockResolvedValue(null);
    render(<VideoPoster project={proj({ status: 'draft' })} />);
    expect(await screen.findByText('No preview yet')).toBeInTheDocument();
    expect(screen.getByTestId('no-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('video-thumb')).toBeNull();
    expect(screen.queryByText('Explainer')).toBeNull();
  });

  it('a thumbnail that fails to load falls back to the panel; a failed lookup too', async () => {
    vi.mocked(videoThumbnail).mockRejectedValue(new Error('gone'));
    render(<VideoPoster project={proj()} />);
    expect(await screen.findByText('No preview yet')).toBeInTheDocument();
  });

  it('while a render runs: the panel with a pulsing dot and "Rendering…"; the new frame is fetched once it ends', async () => {
    vi.mocked(videoThumbnail).mockResolvedValue(null);
    useRender.getState().start('p1', { source: 'agent' });
    render(<VideoPoster project={proj()} />);
    expect(await screen.findByText('Rendering…')).toBeInTheDocument();
    expect(document.querySelector('.tayang-pulse')).not.toBeNull();
    expect(screen.queryByText('No preview yet')).toBeNull();
    // No lookup while the file is still being written.
    expect(videoThumbnail).not.toHaveBeenCalled();
    vi.mocked(videoThumbnail).mockResolvedValue(thumb);
    act(() => useRender.getState().end('p1'));
    expect(await screen.findByTestId('video-thumb')).toBeInTheDocument();
    expect(videoThumbnail).toHaveBeenCalledTimes(1);
  });

  it('reads in Indonesian', async () => {
    setUiLanguage('id');
    vi.mocked(videoThumbnail).mockResolvedValue(null);
    const { unmount } = render(<VideoPoster project={proj()} />);
    expect(await screen.findByText('Belum ada pratinjau')).toBeInTheDocument();
    unmount();
    useRender.getState().start('p1', { source: 'agent' });
    render(<VideoPoster project={proj()} />);
    expect(await screen.findByText('Sedang merender…')).toBeInTheDocument();
  });

  it('the Videos screen follows a project whose status moves while it is open', async () => {
    vi.mocked(videoThumbnail).mockResolvedValue(null);
    vi.mocked(listProjects).mockResolvedValue([proj({ status: 'draft' })]);
    render(<Videos />);
    const row = async () => (await screen.findByRole('button', { name: 'Open Jalur Rempah' })).closest('li')!;
    expect(within(await row()).getByText('Draft')).toBeInTheDocument();
    vi.mocked(listProjects).mockResolvedValue([proj({ status: 'building' })]);
    act(() => useApp.getState().bumpProjects());
    await waitFor(async () => expect(within(await row()).getByText('Building')).toBeInTheDocument());
  });

  it('the Videos screen lists each video as a compact row: picture, title, status and length', async () => {
    vi.mocked(listProjects).mockResolvedValue([proj()]);
    vi.mocked(videoThumbnail).mockResolvedValue(thumb);
    render(<Videos />);
    expect(await screen.findByTestId('video-thumb')).toBeInTheDocument();
    const row = screen.getByTestId('video-thumb').closest('li')!;
    expect(within(row).getByText('Jalur Rempah')).toBeInTheDocument();
    expect(within(row).getByText('Rendered')).toBeInTheDocument();
    await waitFor(() => expect(within(row).getByText('1:06')).toBeInTheDocument());
    expect(within(row).getByRole('button', { name: 'Open Jalur Rempah' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /Schedule/ })).toBeInTheDocument();
  });
});
