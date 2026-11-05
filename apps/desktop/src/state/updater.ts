import { create } from 'zustand';
import { check as checkForUpdate, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

/** First check this long after launch, so it never competes with startup. */
export const FIRST_CHECK_MS = 10 * 1000;
/** Then this often while the app stays open. */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export type UpdatePhase = 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';

interface UpdaterState {
  phase: UpdatePhase;
  /** The new version, once one is found. */
  version: string | null;
  /** Download progress 0-100, or null when the size isn't known. */
  percent: number | null;
  error: string | null;
  /** Asks the release feed for a newer version. Does nothing while one is found or on its way. */
  check(): Promise<void>;
  /** Downloads the found update; it is installed on restart. */
  download(): Promise<void>;
  /** Installs the downloaded update and starts the new version. */
  restart(): Promise<void>;
}

/** The update the feed offered; kept outside the store because it is a live handle, not state. */
let pending: Update | null = null;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useUpdater = create<UpdaterState>((set, get) => ({
  phase: 'idle',
  version: null,
  percent: null,
  error: null,

  check: async () => {
    const { phase } = get();
    if (phase === 'checking' || phase === 'available' || phase === 'downloading' || phase === 'ready') return;
    set({ phase: 'checking', error: null });
    try {
      const update = await checkForUpdate();
      pending = update;
      set(update ? { phase: 'available', version: update.version } : { phase: 'none', version: null });
    } catch (e) {
      set({ phase: 'error', error: message(e) });
    }
  },

  download: async () => {
    if (!pending || get().phase === 'downloading' || get().phase === 'ready') return;
    let total = 0;
    let got = 0;
    set({ phase: 'downloading', percent: null, error: null });
    try {
      await pending.download((ev: DownloadEvent) => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
        else if (ev.event === 'Progress') {
          got += ev.data.chunkLength;
          if (total > 0) set({ percent: Math.min(100, Math.round((got / total) * 100)) });
        }
      });
      set({ phase: 'ready', percent: 100 });
    } catch (e) {
      // The offer still stands: the user can try the download again.
      set({ phase: 'available', error: message(e) });
    }
  },

  restart: async () => {
    if (!pending || get().phase !== 'ready') return;
    try {
      // On Windows the installer closes the app itself; elsewhere the new version is started here.
      await pending.install();
      await relaunch();
    } catch (e) {
      set({ phase: 'error', error: message(e) });
    }
  },
}));

/**
 * Checks shortly after launch and every few hours. Dev builds never check: an update would replace the
 * dev binary with a release. Returns the cleanup.
 */
export function startUpdateChecks(dev: boolean = import.meta.env.DEV): () => void {
  if (dev) return () => {};
  const run = () => void useUpdater.getState().check();
  const first = setTimeout(run, FIRST_CHECK_MS);
  const every = setInterval(run, CHECK_EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

/** For tests: forget the pending update and go back to idle. */
export function resetUpdater() {
  pending = null;
  useUpdater.setState({ phase: 'idle', version: null, percent: null, error: null });
}
