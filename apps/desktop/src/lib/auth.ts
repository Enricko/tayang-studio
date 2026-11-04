import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AuthErrorCode, AuthStart, AuthStatus } from '@tayang/shared';

// Sign in with Google runs in Rust: it talks to the API, keeps the token in the OS keychain and
// only ever tells the webview the state below.

/** Gets a code, opens the browser and starts polling. Rejects with `auth:<code>`. */
export const authStart = () => invoke<AuthStart>('auth_start');
export const authCancel = () => invoke<void>('auth_cancel');
export const authStatus = () => invoke<AuthStatus>('auth_status');
/** Revokes the token at the API when it can, then forgets it here. */
export const authLogout = () => invoke<void>('auth_logout');

export function onAuthChanged(cb: (s: AuthStatus) => void): Promise<UnlistenFn> {
  return listen<AuthStatus>('auth://changed', (e) => cb(e.payload));
}

const CODES: readonly string[] = ['expired', 'denied', 'network', 'server', 'rate-limited', 'storage', 'insecure', 'keychain', 'cancelled'];

/** The code in an `auth:<code>` rejection, or null for anything else. */
export function authErrorCode(e: unknown): AuthErrorCode | 'cancelled' | null {
  const m = /^auth:([a-z-]+)$/.exec(e instanceof Error ? e.message : String(e));
  const code = m?.[1];
  return code && CODES.includes(code) ? (code as AuthErrorCode | 'cancelled') : null;
}
