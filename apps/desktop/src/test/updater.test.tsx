import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));

import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { UpdateBanner } from '@/components/UpdateBanner';
import { CHECK_EVERY_MS, FIRST_CHECK_MS, resetUpdater, startUpdateChecks, useUpdater } from '@/state/updater';
import { useChat } from '@/state/chat';

type Ev = { event: 'Started'; data: { contentLength?: number } } | { event: 'Progress'; data: { chunkLength: number } } | { event: 'Finished' };

function fakeUpdate(opts: { fail?: boolean } = {}) {
  return {
    version: '0.2.0',
    download: vi.fn(async (on: (e: Ev) => void) => {
      if (opts.fail) throw new Error('network down');
      on({ event: 'Started', data: { contentLength: 200 } });
      on({ event: 'Progress', data: { chunkLength: 50 } });
      on({ event: 'Progress', data: { chunkLength: 150 } });
      on({ event: 'Finished' });
    }),
    install: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  resetUpdater();
  vi.mocked(check).mockReset();
  vi.mocked(relaunch).mockReset();
});

describe('updater store', () => {
  it('finds a new version, downloads it with progress, installs and relaunches', async () => {
    const u = fakeUpdate();
    vi.mocked(check).mockResolvedValue(u as never);
    await useUpdater.getState().check();
    expect(useUpdater.getState()).toMatchObject({ phase: 'available', version: '0.2.0' });
    await useUpdater.getState().download();
    expect(useUpdater.getState()).toMatchObject({ phase: 'ready', percent: 100 });
    await useUpdater.getState().restart();
    expect(u.install).toHaveBeenCalled();
    expect(relaunch).toHaveBeenCalled();
  });

  it('says up to date when there is nothing new, and reports a failed check', async () => {
    vi.mocked(check).mockResolvedValue(null);
    await useUpdater.getState().check();
    expect(useUpdater.getState().phase).toBe('none');
    vi.mocked(check).mockRejectedValue(new Error('offline'));
    await useUpdater.getState().check();
    expect(useUpdater.getState()).toMatchObject({ phase: 'error', error: 'offline' });
  });

  it('keeps the offer after a failed download so it can be tried again', async () => {
    vi.mocked(check).mockResolvedValue(fakeUpdate({ fail: true }) as never);
    await useUpdater.getState().check();
    await useUpdater.getState().download();
    expect(useUpdater.getState()).toMatchObject({ phase: 'available', error: 'network down' });
  });

  it('does not check again while an update is found', async () => {
    vi.mocked(check).mockResolvedValue(fakeUpdate() as never);
    await useUpdater.getState().check();
    await useUpdater.getState().check();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('restart does nothing before the download is done', async () => {
    vi.mocked(check).mockResolvedValue(fakeUpdate() as never);
    await useUpdater.getState().check();
    await useUpdater.getState().restart();
    expect(relaunch).not.toHaveBeenCalled();
  });
});

describe('startUpdateChecks', () => {
  afterEach(() => vi.useRealTimers());

  it('checks after launch and then every few hours', async () => {
    vi.useFakeTimers();
    vi.mocked(check).mockResolvedValue(null);
    const stop = startUpdateChecks(false);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(check).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('never checks in a dev build', async () => {
    vi.useFakeTimers();
    startUpdateChecks(true);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2);
    expect(check).not.toHaveBeenCalled();
  });
});

describe('UpdateBanner', () => {
  it('is hidden until an update is found, then downloads and offers a restart', async () => {
    vi.mocked(check).mockResolvedValue(fakeUpdate() as never);
    const { container } = render(<UpdateBanner />);
    expect(container).toBeEmptyDOMElement();
    await act(() => useUpdater.getState().check());
    expect(screen.getByText('Tayang Studio 0.2.0 is out')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(await screen.findByRole('button', { name: 'Restart to update' })).toBeInTheDocument();
  });

  it('warns that restarting stops agents that are working', async () => {
    vi.mocked(check).mockResolvedValue(fakeUpdate() as never);
    await useUpdater.getState().check();
    await useUpdater.getState().download();
    useChat.setState({ streaming: { a: true, b: true } } as never);
    render(<UpdateBanner />);
    expect(screen.getByText('Restarting stops the 2 agents that are working.')).toBeInTheDocument();
    useChat.setState({ streaming: {} } as never);
  });
});
