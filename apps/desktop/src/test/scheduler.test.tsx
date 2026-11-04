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
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@/lib/ipc', () => ({ listProjects: vi.fn(), updateProject: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { listProjects, updateProject } from '@/lib/ipc';
import { onTick, sendTestNotification, startScheduler, tick, TICK_EVENT } from '@/lib/scheduler';
import { setUiLanguage } from '@/i18n';
import { useApp } from '@/state/app';

const proj = (extra: Partial<Project> = {}): Project => ({
  id: 'p', title: 'Kopi Senja', slug: 'k', folder: '/w/k', kind: 'promo', format: '9:16', language: 'id',
  status: 'rendered', styleId: null, scheduledAt: '2026-11-05T10:00:00Z', reviewState: 'none', postedAt: null,
  remindedAt: null, reviewRemindedAt: null, durationSec: null, createdAt: 'c', updatedAt: 'u', ...extra,
});
const now = new Date('2026-11-05T10:00:10Z');
const notified = () =>
  vi.mocked(invoke).mock.calls.map(([cmd, args]) => {
    expect(cmd).toBe('plugin:notification|notify');
    expect((args as { options: { title: string } }).options.title).toBe('Tayang Studio');
    return (args as { options: { body: string } }).options.body;
  });

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ notificationsBlocked: false });
  vi.mocked(isPermissionGranted).mockResolvedValue(true);
  vi.mocked(invoke).mockResolvedValue(undefined);
  vi.mocked(updateProject).mockResolvedValue(proj());
});

describe('scheduler reminders', () => {
  it('notifies once and stamps remindedAt', async () => {
    vi.mocked(listProjects).mockResolvedValue([proj()]);
    await tick(now);
    expect(updateProject).toHaveBeenCalledWith('p', { remindedAt: now.toISOString(), updatedAt: 'u' });
    expect(notified()).toEqual(['Time to post Kopi Senja']);
    // The stamped project no longer qualifies.
    vi.mocked(listProjects).mockResolvedValue([proj({ remindedAt: now.toISOString() })]);
    await tick(now);
    expect(notified()).toHaveLength(1);
  });

  it('uses the review text and field for a pending video, in the interface language', async () => {
    setUiLanguage('id');
    vi.mocked(listProjects).mockResolvedValue([proj({ reviewState: 'pending', scheduledAt: '2026-11-05T11:00:00Z' })]);
    await tick(now);
    expect(updateProject).toHaveBeenCalledWith('p', { reviewRemindedAt: now.toISOString(), updatedAt: 'u' });
    expect(notified()).toEqual(['Cek Kopi Senja sebelum jatuh tempo']);
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
    expect(notified()).toHaveLength(1);
    expect(useApp.getState().notificationsBlocked).toBe(false);
  });

  it('a denied permission sets the in-app banner flag and sends nothing', async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(false);
    vi.mocked(requestPermission).mockResolvedValue('denied');
    vi.mocked(listProjects).mockResolvedValue([proj()]);
    await tick(now);
    expect(notified()).toEqual([]);
    expect(useApp.getState().notificationsBlocked).toBe(true);
  });

  it('does not notify when stamping fails, so the next tick can retry', async () => {
    vi.mocked(listProjects).mockResolvedValue([proj()]);
    vi.mocked(updateProject).mockRejectedValue(new Error('db'));
    await tick(now);
    expect(notified()).toEqual([]);
  });

  it('survives an IPC failure', async () => {
    vi.mocked(listProjects).mockRejectedValue(new Error('down'));
    await expect(tick(now)).resolves.toBeUndefined();
  });
});

describe('scheduler details', () => {
  it('says a pending video is overdue once its time has passed', async () => {
    vi.mocked(listProjects).mockResolvedValue([proj({ reviewState: 'pending' })]);
    await tick(now);
    expect(notified()).toEqual(['Kopi Senja is due and still waiting for your review']);
  });

  it('a failing notification is caught and logged, and later reminders still go out', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(listProjects).mockResolvedValue([proj({ id: 'a', title: 'A' }), proj({ id: 'b', title: 'B' })]);
    vi.mocked(invoke).mockRejectedValueOnce(new Error('no toast'));
    await tick(now);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('an error while checking permission changes nothing: no banner, no stamp', async () => {
    vi.mocked(isPermissionGranted).mockRejectedValue(new Error('ipc'));
    vi.mocked(listProjects).mockResolvedValue([proj()]);
    await tick(now);
    expect(useApp.getState().notificationsBlocked).toBe(false);
    expect(updateProject).not.toHaveBeenCalled();
  });

  it('clears the banner once permission is granted again, without a reminder being due', async () => {
    useApp.setState({ notificationsBlocked: true });
    vi.mocked(listProjects).mockResolvedValue([]);
    await tick(now);
    await vi.waitFor(() => expect(useApp.getState().notificationsBlocked).toBe(false));
  });

  it('the test notification sends one, or flags the banner on a denial', async () => {
    await expect(sendTestNotification()).resolves.toBe(true);
    expect(notified()).toEqual(['This is a test notification. If you can read it, reminders will reach you.']);
    vi.mocked(invoke).mockClear();
    vi.mocked(isPermissionGranted).mockResolvedValue(false);
    vi.mocked(requestPermission).mockResolvedValue('denied');
    await expect(sendTestNotification()).resolves.toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    expect(useApp.getState().notificationsBlocked).toBe(true);
  });
});

describe('tick handlers', () => {
  it('a slow handler skips only its own next ticks and never delays reminders or other handlers', async () => {
    vi.mocked(listProjects).mockResolvedValue([proj()]);
    let finish!: () => void;
    const slow = vi.fn(() => new Promise<void>((res) => (finish = res)));
    const quick = vi.fn();
    const offs = [onTick(slow), onTick(quick)];
    await tick(now);
    expect(notified()).toHaveLength(1); // reminders ran while slow is still pending
    vi.mocked(listProjects).mockResolvedValue([]);
    await tick(now);
    await tick(now);
    expect(slow).toHaveBeenCalledTimes(1);
    expect(quick).toHaveBeenCalledTimes(3);
    finish();
    await vi.waitFor(async () => {
      await tick(now);
      expect(slow).toHaveBeenCalledTimes(2);
    });
    offs.forEach((off) => off());
  });

  it('logs a handler error and keeps calling it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(listProjects).mockResolvedValue([]);
    const bad = vi.fn().mockRejectedValue(new Error('boom'));
    const off = onTick(bad);
    await tick(now);
    await vi.waitFor(() => expect(log).toHaveBeenCalled());
    await tick(now);
    expect(bad).toHaveBeenCalledTimes(2);
    off();
    log.mockRestore();
  });
});

describe('scheduler wiring', () => {
  it('startScheduler runs a pass at once and on each tick event; handlers can unsubscribe', async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    const seen = vi.fn();
    const off = onTick(seen);
    const unlisten = await startScheduler();
    await vi.waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0)); // let the first call settle: a pending handler skips ticks
    listeners[TICK_EVENT]!();
    await vi.waitFor(() => expect(seen).toHaveBeenCalledTimes(2));
    off();
    await new Promise((r) => setTimeout(r, 0));
    listeners[TICK_EVENT]!();
    await vi.waitFor(() => expect(listProjects).toHaveBeenCalledTimes(3));
    expect(seen).toHaveBeenCalledTimes(2);
    unlisten();
    expect(listeners[TICK_EVENT]).toBeUndefined();
  });
});
