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
    expect(await screen.findByText('New chat', { selector: 'h1' })).toBeInTheDocument();
    expect(useApp.getState().route.name).toBe('chat-new');
  });
});
