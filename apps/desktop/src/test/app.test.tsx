import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { Settings } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({ getSettings: vi.fn(), listProjects: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/events', () => ({ onAgentUpdate: vi.fn(), onPermission: vi.fn() }));

import { getSettings } from '@/lib/ipc';
import App from '@/App';
import { useApp } from '@/state/app';

const base: Settings = {
  workingFolder: '/tmp/Tayang',
  defaultAgent: 'claude',
  frameCheck: true,
  language: 'id',
  format: '9:16',
  fps: 30,
  onboarded: false,
  apiUrl: 'https://api.tayang.app',
  installId: '',
  shareInstallStats: true,
  lastPingAt: null,
};

describe('App start', () => {
  beforeEach(() => useApp.setState({ route: { name: 'welcome' }, settings: null }));

  it('shows welcome when not onboarded', async () => {
    vi.mocked(getSettings).mockResolvedValue(base);
    render(<App />);
    expect(await screen.findByText('Get started')).toBeInTheDocument();
  });

  it('goes to a new chat when onboarded', async () => {
    vi.mocked(getSettings).mockResolvedValue({ ...base, onboarded: true });
    render(<App />);
    expect(await screen.findByText('What are we making?', { selector: 'h1' })).toBeInTheDocument();
    expect(useApp.getState().route.name).toBe('chat-new');
  });
});

describe('App settings failure', () => {
  it('shows an error with Try again instead of a blank window', async () => {
    useApp.setState({ route: { name: 'welcome' }, settings: null });
    vi.mocked(getSettings).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(base);
    render(<App />);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    retry.click();
    expect(await screen.findByText('Get started')).toBeInTheDocument();
  });
});
