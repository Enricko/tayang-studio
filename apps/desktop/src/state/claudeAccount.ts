import { create } from 'zustand';
import { claudeSignIn, claudeSignInCancel, claudeSignOut, getClaudeAccount, onClaudeSignInUrl, type ClaudeAccount } from '@/lib/claudeAccount';
import { track } from '@/lib/analytics';

/** Rust's answer when the user pressed Cancel: not an error to show. */
const CANCELLED = 'cancelled';

interface ClaudeAccountState {
  /** Null until the first check is back. */
  account: ClaudeAccount | null;
  /** A sign-in is waiting for the browser. */
  signingIn: boolean;
  /** The sign-in page, once Claude Code has printed it. */
  url: string | null;
  error: string | null;
  refresh(): Promise<void>;
  /** Resolves true once signed in. */
  signIn(): Promise<boolean>;
  cancel(): Promise<void>;
  signOut(): Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useClaudeAccount = create<ClaudeAccountState>((set, get) => ({
  account: null,
  signingIn: false,
  url: null,
  error: null,
  async refresh() {
    try {
      set({ account: await getClaudeAccount() });
    } catch {
      set({ account: { signedIn: false, email: null, plan: null } });
    }
  },
  async signIn() {
    if (get().signingIn) return false;
    set({ signingIn: true, url: null, error: null });
    const off = await onClaudeSignInUrl((url) => set({ url })).catch(() => undefined);
    try {
      const account = await claudeSignIn();
      set({ account });
      track('claude signed in', { plan: account.plan });
      return account.signedIn;
    } catch (e) {
      const why = message(e);
      if (why !== CANCELLED) set({ error: why });
      return false;
    } finally {
      off?.();
      set({ signingIn: false, url: null });
    }
  },
  async cancel() {
    await claudeSignInCancel().catch(() => undefined);
  },
  async signOut() {
    try {
      set({ account: await claudeSignOut(), error: null });
    } catch (e) {
      set({ error: message(e) });
    }
  },
}));
