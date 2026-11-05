import { create } from 'zustand';
import type { UsageResponse } from '@tayang/shared';
import { cloudErrorCode, cloudUsage, type CloudErrorCode } from '@/lib/cloud';

/** Refresh this often while the app is open, so the sidebar's credits follow what agents spend. */
export const TAYANG_USAGE_EVERY_MS = 5 * 60 * 1000;

interface TayangUsageState {
  /** The signed-in account's credits, auto-posts and gifts; null signed out or not loaded yet. */
  usage: UsageResponse | null;
  error: CloudErrorCode | null;
  loading: boolean;
  /** Fetches it again (after a redeem, a post, or the user's refresh). */
  load(): Promise<void>;
  /** Signed out: forget it. */
  clear(): void;
}

/**
 * The Tayang account's usage, shared by the sidebar, Settings › Usage and the gift code card, so one
 * fetch updates all of them.
 */
export const useTayangUsage = create<TayangUsageState>((set) => ({
  usage: null,
  error: null,
  loading: false,
  load: async () => {
    set({ loading: true, error: null });
    try {
      set({ usage: await cloudUsage(), loading: false });
    } catch (e) {
      set({ error: cloudErrorCode(e), loading: false });
    }
  },
  clear: () => set({ usage: null, error: null, loading: false }),
}));
