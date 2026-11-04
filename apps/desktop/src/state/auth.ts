import { create } from 'zustand';
import type { AuthErrorCode, AuthStart, AuthStatus } from '@tayang/shared';
import { authCancel, authErrorCode, authLogout, authStart, authStatus, onAuthChanged } from '@/lib/auth';

/** The sign-in dialog. `failed` holds an error code, or the raw message of an unexpected failure. */
export type SignInFlow =
  | { phase: 'closed' }
  | { phase: 'starting' }
  | { phase: 'waiting'; start: AuthStart }
  | { phase: 'failed'; error: AuthErrorCode | { message: string } };

interface AuthStore {
  /** What Rust last said; null until it has. */
  status: AuthStatus | null;
  flow: SignInFlow;
  /** Bumped by every sign-in and cancel, so a late answer from an old one is dropped. */
  attempt: number;
  listening: boolean;
  /** Listens for `auth://changed` and reads the current state. Safe to call again. */
  init(): Promise<void>;
  apply(s: AuthStatus): void;
  /** Opens the dialog and starts (or restarts) signing in. */
  signIn(): Promise<void>;
  cancel(): void;
  /** Rejects when Rust couldn't forget the token. */
  logout(): Promise<void>;
}

const active = (f: SignInFlow) => f.phase === 'starting' || f.phase === 'waiting';

export const useAuth = create<AuthStore>((set, get) => ({
  status: null,
  flow: { phase: 'closed' },
  attempt: 0,
  listening: false,

  async init() {
    if (get().listening) return;
    set({ listening: true });
    try {
      await onAuthChanged((s) => get().apply(s));
    } catch {
      // No Tauri (tests, a plain browser): stay signed out.
    }
    try {
      get().apply(await authStatus());
    } catch {
      // Same.
    }
  },

  apply(s) {
    const { flow } = get();
    if (s.state === 'signed-in' && flow.phase !== 'closed') set({ status: s, flow: { phase: 'closed' } });
    else if (active(flow) && s.state === 'error') set({ status: s, flow: { phase: 'failed', error: s.error ?? 'server' } });
    else set({ status: s });
  },

  async signIn() {
    const attempt = get().attempt + 1;
    set({ attempt, flow: { phase: 'starting' } });
    try {
      const start = await authStart();
      if (get().attempt === attempt && get().flow.phase === 'starting') set({ flow: { phase: 'waiting', start } });
    } catch (e) {
      const code = authErrorCode(e);
      if (code === 'cancelled' || get().attempt !== attempt || !active(get().flow)) return;
      set({ flow: { phase: 'failed', error: code ?? { message: e instanceof Error ? e.message : String(e) } } });
    }
  },

  cancel() {
    set((s) => ({ attempt: s.attempt + 1, flow: { phase: 'closed' } }));
    authCancel().catch(() => {});
  },

  async logout() {
    await authLogout();
  },
}));
