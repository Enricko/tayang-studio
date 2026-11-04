import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { Project } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  listProjects: vi.fn(),
}));

import { listProjects } from '@/lib/ipc';
import { Sidebar } from '@/components/Sidebar';
import { useApp } from '@/state/app';

const mk = (id: string, title: string): Project => ({
  id,
  title,
  slug: id,
  folder: `/tmp/${id}`,
  kind: 'explainer',
  format: '9:16',
  language: 'id',
  status: 'draft',
  styleId: null,
  scheduledAt: null, reviewState: 'none', postedAt: null, remindedAt: null,
  durationSec: null,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
});

describe('Sidebar', () => {
  beforeEach(() => {
    vi.mocked(listProjects).mockResolvedValue([
      mk('a', 'Kenapa rupiah melemah?'),
      mk('b', '3 cara hemat pajak UMKM'),
      mk('c', 'Promo Kopi Senja'),
    ]);
  });

  it('marks the active item, shows New chat and recent projects', async () => {
    render(<Sidebar active="videos" />);
    expect(screen.getByRole('link', { name: /^Videos/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^Chat/ })).not.toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('New chat')).toBeInTheDocument();
    expect(await screen.findByText('Kenapa rupiah melemah?')).toBeInTheDocument();
    expect(screen.getByText('3 cara hemat pajak UMKM')).toBeInTheDocument();
    expect(screen.getByText('Promo Kopi Senja')).toBeInTheDocument();
    expect(screen.getByText('Recent')).toBeInTheDocument();
  });

  it('shows the needs-you count on Agents only when above zero', () => {
    useApp.setState({ needsYouCount: 2 });
    const { unmount } = render(<Sidebar active="chat" />);
    expect(screen.getByRole('link', { name: /^Agents/ })).toHaveTextContent('2');
    unmount();
    useApp.setState({ needsYouCount: 0 });
    render(<Sidebar active="chat" />);
    expect(screen.getByRole('link', { name: /^Agents/ })).not.toHaveTextContent(/\d/);
  });
});
