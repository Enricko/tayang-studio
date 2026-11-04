import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { Settings } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  listProjects: vi.fn().mockResolvedValue([]),
  syncStyles: vi.fn().mockResolvedValue({ styles: [], offline: false }),
}));
vi.mock('@/lib/events', () => ({ onAgentUpdate: vi.fn(), onPermission: vi.fn() }));

import { getSettings, syncStyles, updateSettings } from '@/lib/ipc';
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
  autoMode: false,
  lastPingAt: null,
  uiLanguage: null,
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

describe('App interface language', () => {
  beforeEach(() => useApp.setState({ route: { name: 'welcome' }, settings: null }));

  it('first run: follows an Indonesian system language, saves it, and sets <html lang>', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('id-ID');
    vi.mocked(getSettings).mockResolvedValue(base);
    vi.mocked(updateSettings).mockClear().mockImplementation(async (p) => ({ ...base, ...p }));
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Mulai' })).toBeInTheDocument();
    expect(updateSettings).toHaveBeenCalledWith({ uiLanguage: 'id' });
    expect(document.documentElement.lang).toBe('id');
    vi.restoreAllMocks();
  });

  it('a saved language wins over the system language and is not saved again', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('id-ID');
    vi.mocked(getSettings).mockResolvedValue({ ...base, uiLanguage: 'en' });
    vi.mocked(updateSettings).mockClear();
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Get started' })).toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('App built-in styles', () => {
  it('syncs the styles in the background at startup, and a failed sync changes nothing', async () => {
    useApp.setState({ route: { name: 'welcome' }, settings: null });
    vi.mocked(syncStyles).mockClear().mockRejectedValueOnce(new Error('offline'));
    vi.mocked(getSettings).mockResolvedValue({ ...base, onboarded: true });
    render(<App />);
    expect(await screen.findByText('What are we making?', { selector: 'h1' })).toBeInTheDocument();
    expect(syncStyles).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
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
