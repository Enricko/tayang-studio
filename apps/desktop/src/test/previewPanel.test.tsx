import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { Chat, Project } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  getChat: vi.fn(),
  listProjects: vi.fn(),
  listMessages: vi.fn().mockResolvedValue([]),
  renderCommand: vi.fn().mockResolvedValue(null),
  mediaLatestRender: vi.fn().mockResolvedValue(null),
  mediaProbe: vi.fn().mockResolvedValue(null),
  mediaThumbnails: vi.fn().mockResolvedValue([]),
  mediaRender: vi.fn(),
  assetUrl: (p: string) => p,
}));
vi.mock('@/lib/events', () => ({ onAgentUpdate: vi.fn(async () => () => {}), onPermission: vi.fn(async () => () => {}) }));

import * as ipc from '@/lib/ipc';
import { ChatProject } from '@/screens/ChatProject';
import { CHAT_MIN, PREVIEW, SIDEBAR, layoutKey, useLayout } from '@/state/layout';

const project: Project = {
  id: 'p1',
  title: 'Kenapa rupiah melemah?',
  slug: 'p1',
  folder: '/tmp/p1',
  kind: 'explainer',
  format: '9:16',
  language: 'id',
  status: 'draft',
  styleId: null,
  scheduledAt: null, reviewState: 'none', postedAt: null, remindedAt: null, reviewRemindedAt: null,
  durationSec: null,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
};
const chat = { id: 'c1', projectId: 'p1', agentId: 'claude', title: 't', createdAt: '', updatedAt: '' } as unknown as Chat;

async function renderChat() {
  const view = render(<ChatProject chatId="c1" />);
  const handle = await screen.findByRole('separator', { name: 'Resize preview' });
  return { view, handle, panel: document.getElementById('chat-preview')! };
}

function drag(handle: HTMLElement, from: number, to: number) {
  handle.setPointerCapture = () => {};
  fireEvent.pointerDown(handle, { clientX: from, pointerId: 1, button: 0 });
  fireEvent.pointerMove(handle, { clientX: to, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientX: to, pointerId: 1 });
}

describe('project chat preview panel', () => {
  beforeEach(() => {
    localStorage.clear();
    window.innerWidth = 1600;
    useLayout.getState().hydrate();
    vi.mocked(ipc.getChat).mockResolvedValue(chat);
    vi.mocked(ipc.listProjects).mockResolvedValue([project]);
  });

  it('opens at 380 px with a handle on its left edge', async () => {
    const { handle, panel } = await renderChat();
    expect(panel.style.width).toBe(`${PREVIEW.default}px`);
    expect(handle).toHaveAttribute('aria-controls', 'chat-preview');
    expect(handle).toHaveAttribute('aria-valuemin', String(PREVIEW.min));
    expect(handle).toHaveAttribute('aria-valuemax', String(PREVIEW.max));
    expect(handle.className).toMatch(/left-0/);
  });

  it('grows when dragged left, up to its max, and saves the width', async () => {
    const { handle, panel } = await renderChat();
    drag(handle, 1000, 900);
    expect(panel.style.width).toBe('480px');
    drag(handle, 900, 100);
    expect(panel.style.width).toBe(`${PREVIEW.max}px`);
    expect(JSON.parse(localStorage.getItem(layoutKey())!)).toMatchObject({ preview: PREVIEW.max });
    drag(handle, 100, 1500);
    expect(panel.style.width).toBe(`${PREVIEW.min}px`);
  });

  it('keyboard: arrows by 16 px, Home and End to min and max; double-click resets', async () => {
    const { handle, panel } = await renderChat();
    handle.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(panel.style.width).toBe(`${PREVIEW.default + 16}px`);
    await userEvent.keyboard('{Home}');
    expect(panel.style.width).toBe(`${PREVIEW.min}px`);
    await userEvent.keyboard('{End}');
    expect(panel.style.width).toBe(`${PREVIEW.max}px`);
    fireEvent.doubleClick(handle);
    expect(panel.style.width).toBe(`${PREVIEW.default}px`);
  });

  it('caps at 55% of the window and leaves the chat its 420 px', async () => {
    window.innerWidth = 1200;
    useLayout.getState().hydrate();
    const { handle, panel } = await renderChat();
    const max = 1200 - SIDEBAR.default - CHAT_MIN;
    expect(handle).toHaveAttribute('aria-valuemax', String(max));
    drag(handle, 800, 0);
    expect(panel.style.width).toBe(`${max}px`);
    expect(screen.getByRole('region', { name: 'Conversation' }).className).toMatch(/min-w-0/);
  });

  it('shrinks to make room for the chat in a narrow window', async () => {
    window.innerWidth = 1000;
    useLayout.getState().hydrate();
    const { panel } = await renderChat();
    expect(panel.style.width).toBe(`${1000 - SIDEBAR.default - CHAT_MIN}px`);
  });

  it('tells the layout it is open while it shows', async () => {
    const { view } = await renderChat();
    expect(useLayout.getState().previewOpen).toBe(true);
    view.unmount();
    expect(useLayout.getState().previewOpen).toBe(false);
  });
});
