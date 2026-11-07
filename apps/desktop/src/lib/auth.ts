import { isWeb } from '@/lib/platform';
import { rpc } from '@/lib/webRpc';
import type { AuthErrorCode, AuthStart, AuthStatus } from '@tayang/shared';

// Sign in with Google runs in Rust: it talks to the API, keeps the token in the OS keychain and
// only ever tells the webview the state below.

/** Gets a code, opens the browser and starts polling. Rejects with `auth:<code>`. */
export const authStart = async (): Promise<AuthStart> => {
  if (isWeb) {
    throw new Error('Tayang cloud sign-in is not available in the self-hosted web edition. Local projects and agents work without it.');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<AuthStart>('auth_start');
};
export const authCancel = async (): Promise<void> => {
  if (isWeb) return;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<void>('auth_cancel');
};
export const authStatus = () =>
  isWeb ? rpc<AuthStatus>('auth_status') : import('@tauri-apps/api/core').then(({ invoke }) => invoke<AuthStatus>('auth_status'));
/** Revokes the token at the API when it can, then forgets it here. */
export const authLogout = async (): Promise<void> => {
  if (isWeb) return;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<void>('auth_logout');
};

export async function onAuthChanged(_cb: (s: AuthStatus) => void): Promise<() => void> {
  if (isWeb) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<AuthStatus>('auth://changed', (e) => _cb(e.payload));
}

const CODES: readonly string[] = ['expired', 'denied', 'network', 'server', 'rate-limited', 'storage', 'insecure', 'keychain', 'cancelled'];

/** The code in an `auth:<code>` rejection, or null for anything else. */
export function authErrorCode(e: unknown): AuthErrorCode | 'cancelled' | null {
  const m = /^auth:([a-z-]+)$/.exec(e instanceof Error ? e.message : String(e));
  const code = m?.[1];
  return code && CODES.includes(code) ? (code as AuthErrorCode | 'cancelled') : null;
}
