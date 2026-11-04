import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@tayang/shared';

const listeners: Record<string, () => void> = {};
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, cb: () => void) => {
    listeners[name] = cb;
    return () => delete listeners[name];
  }),
}));
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));
vi.mock('@/lib/ipc', () => ({ listProjects: vi.fn(), updateProject: vi.fn() }));

import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { listProjects, updateProject } from '@/lib/ipc';
import { onTick, startScheduler, tick, TICK_EVENT } from '@/lib/scheduler';
import { setUiLanguage } from '@/i18n';
import { useApp } from '@/state/app';

const proj = (extra: Partial<Project> = {}): Project => ({
  id: 'p', title: 'Kopi Senja', slug: 'k', folder: '/w/k', kind: 'promo', format: '9:16', language: 'id',
  status: 'rendered', styleId: null, scheduledAt: '2026-11-05T10:00:00Z', reviewState: 'none', postedAt: null,
  remindedAt: null, reviewRemindedAt: null, durationSec: null, createdAt: 'c', updatedAt: 'u', ...extra,
});
const now = new Date('2026-11-05T10:00:10Z');

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ notificationsBlocked: false });
  vi.mocked(isPermissionGranted).mockResolvedValue(true);
  vi.mocked(updateProject).mockResolvedValue(proj());
});

describe('scheduler reminders', () => {
  it('notifies once and stamps remindedAt', async () => {
    vi.mocked(listProjects).mockResolvedValue([proj()]);
    await tick(now);
    expect(updateProject).toHaveBeenCalledWith('p', { remindedAt: now.toISOString() });
    expect(sendNotification).toHaveBeenCalledWith({ title: 'Tayang Studio', body: 'Time to post Kopi Senja' });
    // The stamped project no longer qualifies.
    vi.mocked(listProjects).mockResolvedValue([proj({ remindedAt: now.toISOString() })]);
    await tick(now);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('uses the review text and field for a pending video, in the interface language', async () => {
    setUiLanguage('id');
    vi.mocked(listProjects).mockResolvedValue([proj({ reviewState: 'pending', scheduledAt: '2026-11-05T11:00:00Z' })]);
    await tick(now);
    expect(updateProject).toHaveBeenCalledWith('p', { reviewRemindedAt: now.toISOString() });
    expect(sendNotification).toHaveBeenCalledWith({ title: 'Tayang Studio', body: 'Cek Kopi Senja sebelum jatuh tempo' });
  });

  it('does not ask for permission when nothing is due', async () => {
    vi.mocked(listProjects).mockResolvedValue([proj({ scheduledAt: '2026-11-09T10:00:00Z' })]);
    await tick(now);
    expect(isPermissionGranted).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('asks for permission the first time a reminder is needed', async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(false);
    vi.mocked(requestPermission).mockResolvedValue('granted');
    vi.mocked(listProjects).mockResolvedValue([proj()]);
    await tick(now);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(useApp.getState().notificationsBlocked).toBe(false);
  });

  it('a denied permission sets the in-app banner flag and sends nothing', async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(false);
    vi.mocked(requestPermission).mockResolvedValue('denied');
    vi.mocked(listProjects).mockResolvedValue([proj()]);
    await tick(now);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(useApp.getState().notificationsBlocked).toBe(true);
  });

  it('does not notify when stamping fails, so the next tick can retry', async () => {
    vi.mocked(listProjects).mockResolvedValue([proj()]);
    vi.mocked(updateProject).mockRejectedValue(new Error('db'));
    await tick(now);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('survives an IPC failure', async () => {
    vi.mocked(listProjects).mockRejectedValue(new Error('down'));
    await expect(tick(now)).resolves.toBeUndefined();
  });
});

describe('scheduler wiring', () => {
  it('startScheduler runs a pass at once and on each tick event; handlers can unsubscribe', async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    const seen = vi.fn();
    const off = onTick(seen);
    const unlisten = await startScheduler();
    await vi.waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
    listeners[TICK_EVENT]();
    await vi.waitFor(() => expect(seen).toHaveBeenCalledTimes(2));
    off();
    listeners[TICK_EVENT]();
    await vi.waitFor(() => expect(listProjects).toHaveBeenCalledTimes(3));
    expect(seen).toHaveBeenCalledTimes(2);
    unlisten();
    expect(listeners[TICK_EVENT]).toBeUndefined();
  });
});
