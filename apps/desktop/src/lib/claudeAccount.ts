import { isWeb } from '@/lib/platform';
import { rpc } from '@/lib/webRpc';
import { onClaudeSignInUrl } from '@/lib/events';

/** Who is signed in to Claude in Tayang (Tayang's own Claude config folder, see claude_account.rs). */
export interface ClaudeAccount {
  signedIn: boolean;
  email: string | null;
  /** The Claude plan, such as `pro` or `max`. */
  plan: string | null;
}

export const getClaudeAccount = () => isWeb ? rpc<ClaudeAccount>('claude_account') : invokeTauri<ClaudeAccount>('claude_account');
/** Claude Code opens the browser; resolves once the user has signed in there. */
export const claudeSignIn = () => isWeb ? rpc<ClaudeAccount>('claude_sign_in') : invokeTauri<ClaudeAccount>('claude_sign_in');
export const claudeSignInCancel = () => isWeb ? rpc<void>('claude_sign_in_cancel') : invokeTauri<void>('claude_sign_in_cancel');
export const claudeSignOut = () => isWeb ? rpc<ClaudeAccount>('claude_sign_out') : invokeTauri<ClaudeAccount>('claude_sign_out');
/** The sign-in page, for when the browser didn't open by itself. */
export { onClaudeSignInUrl };

async function invokeTauri<T>(cmd: string): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd);
}
