import { create } from 'zustand';
import { isWeb, checkForUpdate, type AvailableUpdate } from '@/lib/platform';
import { track } from '@/lib/analytics';

/** First check this long after launch, so it never competes with startup. */
export const FIRST_CHECK_MS = 10 * 1000;
/** Then this often while the app stays open. */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export type UpdatePhase = 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';

interface UpdaterState {
  phase: UpdatePhase;
  version: string | null;
  percent: number | null;
  error: string | null;
  check(): Promise<void>;
  download(): Promise<void>;
  restart(): Promise<void>;
}

let pending: AvailableUpdate | null = null;

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
    set({ phase: 'downloading', percent: null, error: null });
    try {
      await pending.download((percent) => set({ percent }));
      set({ phase: 'ready', percent: 100 });
    } catch (e) {
      set({ phase: 'available', error: message(e) });
    }
  },

  restart: async () => {
    if (!pending || get().phase !== 'ready') return;
    try {
      if (pending.version) track('update installed', { version: pending.version });
      await pending.install();
    } catch (e) {
      set({ phase: 'error', error: message(e) });
    }
  },
}));

/**
 * Checks shortly after launch and every few hours. Dev builds never check, and the web edition is
 * updated by deploying a new server; it has no in-app updater.
 */
export function startUpdateChecks(dev: boolean = import.meta.env.DEV): () => void {
  if (dev || isWeb) return () => {};
  const run = () => void useUpdater.getState().check();
  const first = setTimeout(run, FIRST_CHECK_MS);
  const every = setInterval(run, CHECK_EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

export function resetUpdater() {
  pending = null;
  useUpdater.setState({ phase: 'idle', version: null, percent: null, error: null });
}
