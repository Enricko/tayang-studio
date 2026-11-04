import { create } from 'zustand';
import type { AgentUsage } from '@tayang/shared';
import { getAgentUsage } from '@/lib/ipc';

export const POLL_MS = 5 * 60 * 1000;

interface UsageState {
  usage: AgentUsage[];
  loading: boolean;
  loaded: boolean;
  /** Loads now and every five minutes. Safe to call again. */
  start(): void;
  refresh(force?: boolean): Promise<void>;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** A failed refresh keeps the last good numbers instead of blanking the bar. */
export function mergeUsage(prev: AgentUsage[], next: AgentUsage[]): AgentUsage[] {
  return next.map((n) => {
    if (n.status !== 'error') return n;
    const old = prev.find((p) => p.agentId === n.agentId && p.status === 'ok');
    return old ? { ...old, message: n.message } : n;
  });
}

export const useUsage = create<UsageState>((set, get) => ({
  usage: [],
  loading: false,
  loaded: false,
  start: () => {
    if (timer) return;
    void get().refresh(false);
    timer = setInterval(() => void get().refresh(false), POLL_MS);
  },
  refresh: async (force = true) => {
    set({ loading: true });
    try {
      const next = await getAgentUsage(force);
      set((s) => ({ usage: mergeUsage(s.usage, next), loading: false, loaded: true }));
    } catch {
      set({ loading: false, loaded: true });
    }
  },
}));

/** Test helper: stops the poll timer. */
export function stopUsagePolling() {
  if (timer) clearInterval(timer);
  timer = null;
}
