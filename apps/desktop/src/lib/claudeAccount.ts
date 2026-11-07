import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Who is signed in to Claude in Tayang (Tayang's own Claude config folder, see claude_account.rs). */
export interface ClaudeAccount {
  signedIn: boolean;
  email: string | null;
  /** The Claude plan, such as `pro` or `max`. */
  plan: string | null;
}

export const getClaudeAccount = () => invoke<ClaudeAccount>('claude_account');
/** Claude Code opens the browser; resolves once the user has signed in there. */
export const claudeSignIn = () => invoke<ClaudeAccount>('claude_sign_in');
export const claudeSignInCancel = () => invoke<void>('claude_sign_in_cancel');
export const claudeSignOut = () => invoke<ClaudeAccount>('claude_sign_out');
/** The sign-in page, for when the browser didn't open by itself. */
export const onClaudeSignInUrl = (cb: (url: string) => void) => listen<string>('claude://sign-in-url', (e) => cb(e.payload));
