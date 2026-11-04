import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { Settings } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  systemLocale: vi.fn(),
  listProjects: vi.fn().mockResolvedValue([]),
  getAgentUsage: vi.fn().mockResolvedValue([]),
  syncStyles: vi.fn().mockResolvedValue({ styles: [], offline: false }),
  getChat: vi.fn().mockResolvedValue(null),
  listMessages: vi.fn().mockResolvedValue([]),
  renderCommand: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/events', () => ({ onAgentUpdate: vi.fn(), onPermission: vi.fn() }));
vi.mock('@/state/autopilot', () => ({ startAutopilot: vi.fn(() => () => {}) }));
vi.mock('@/lib/buildJobs', () => ({ settleLateRenders: vi.fn(), recheckDoneBuildJobs: vi.fn().mockResolvedValue(undefined) }));

import { getSettings } from '@/lib/ipc';
import App from '@/App';
import { useApp } from '@/state/app';
import { SIDEBAR, layoutKey, useLayout } from '@/state/layout';

const settings: Settings = {
  workingFolder: '/tmp/Tayang',
  defaultAgent: 'claude',
  frameCheck: true,
  language: 'id',
  format: '9:16',
  fps: 30,
  onboarded: true,
  apiUrl: 'https://studio.tayang.app/api',
  installId: '',
  shareInstallStats: true,
  autoMode: false,
  lastPingAt: null,
  uiLanguage: 'en',
  backgroundMode: false,
  openAtLogin: false,
  buildJobsChecked: true,
};

async function renderApp() {
  vi.mocked(getSettings).mockResolvedValue(settings);
  render(<App />);
  const handle = await screen.findByRole('separator', { name: 'Resize sidebar' });
  return { handle, panel: document.getElementById('app-sidebar')! };
}

function drag(handle: HTMLElement, from: number, to: number) {
  handle.setPointerCapture = () => {};
  fireEvent.pointerDown(handle, { clientX: from, pointerId: 1, button: 0 });
  fireEvent.pointerMove(handle, { clientX: to, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientX: to, pointerId: 1 });
}

describe('App sidebar resizing', () => {
  beforeEach(() => {
    localStorage.clear();
    window.innerWidth = 1440;
    useLayout.getState().hydrate();
    useApp.setState({ route: { name: 'welcome' }, settings: null });
  });

  it('starts at the default width with the handle on its right edge', async () => {
    const { handle, panel } = await renderApp();
    expect(panel.style.width).toBe(`${SIDEBAR.default}px`);
    expect(handle).toHaveAttribute('aria-valuenow', String(SIDEBAR.default));
    expect(handle).toHaveAttribute('aria-valuemax', String(SIDEBAR.max));
    expect(handle).toHaveAttribute('aria-controls', 'app-sidebar');
  });

  it('drags wider within its max, and saves the width', async () => {
    const { handle, panel } = await renderApp();
    drag(handle, 232, 300);
    expect(panel.style.width).toBe('300px');
    drag(handle, 300, 900);
    expect(panel.style.width).toBe(`${SIDEBAR.max}px`);
    expect(JSON.parse(localStorage.getItem(layoutKey())!)).toMatchObject({ sidebar: SIDEBAR.max, collapsed: false });
  });

  it('snaps to the icon rail below 140 px and comes back when dragged out', async () => {
    const { handle, panel } = await renderApp();
    drag(handle, 232, 180);
    expect(panel.style.width).toBe(`${SIDEBAR.min}px`);
    drag(handle, 200, 120);
    expect(panel.style.width).toBe(`${SIDEBAR.rail}px`);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav).toHaveAttribute('data-collapsed', 'true');
    // the rail: icons with names, no recent list, no wordmark
    expect(within(nav).getByRole('link', { name: 'Videos' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    expect(within(nav).queryByText('Recent')).toBeNull();
    // usage as a small ring
    expect(within(nav).getByRole('progressbar', { name: '5 hour usage' }).closest('button')).toHaveClass('size-10');
    // out again
    drag(handle, 64, 260);
    expect(panel.style.width).toBe('260px');
    expect(nav).not.toHaveAttribute('data-collapsed');
  });

  it('⌘\\ and Ctrl+\\ toggle the collapse', async () => {
    const { panel } = await renderApp();
    act(() => void fireEvent.keyDown(window, { key: '\\', metaKey: true }));
    expect(panel.style.width).toBe(`${SIDEBAR.rail}px`);
    act(() => void fireEvent.keyDown(window, { key: '\\', ctrlKey: true }));
    expect(panel.style.width).toBe(`${SIDEBAR.default}px`);
  });

  it('Enter on the handle toggles, double-click resets', async () => {
    const { handle, panel } = await renderApp();
    handle.focus();
    await userEvent.keyboard('{Enter}');
    expect(panel.style.width).toBe(`${SIDEBAR.rail}px`);
    await userEvent.keyboard('{Enter}');
    expect(panel.style.width).toBe(`${SIDEBAR.default}px`);
    drag(handle, 232, 330);
    fireEvent.doubleClick(handle);
    expect(panel.style.width).toBe(`${SIDEBAR.default}px`);
  });

  it('restores the saved width and collapse', async () => {
    localStorage.setItem(layoutKey(), JSON.stringify({ sidebar: 290, collapsed: true, preview: 400 }));
    useLayout.getState().hydrate();
    const { handle, panel } = await renderApp();
    expect(panel.style.width).toBe(`${SIDEBAR.rail}px`);
    handle.focus();
    await userEvent.keyboard('{Enter}');
    expect(panel.style.width).toBe('290px');
  });

  it('on a project chat, leaves room for the preview at its min too', async () => {
    window.innerWidth = 1000;
    useLayout.getState().hydrate();
    const { handle } = await renderApp();
    act(() => useApp.getState().navigate({ name: 'chat', chatId: 'c1' }));
    // 1000 − 420 chat − 300 preview min
    expect(handle).toHaveAttribute('aria-valuemax', '280');
  });

  it('keeps the chat 420 px wide in a narrow window', async () => {
    window.innerWidth = 700;
    useLayout.getState().hydrate();
    const { handle, panel } = await renderApp();
    drag(handle, 232, 600);
    expect(panel.style.width).toBe(`${700 - 420}px`);
    expect(handle).toHaveAttribute('aria-valuemax', String(700 - 420));
  });
});
