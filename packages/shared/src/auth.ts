import type { Entitlements } from './api';

// Sign in with Google, OAuth 2.0 device-authorization style. The desktop asks for a device
// code, the user approves it in the browser, and the desktop polls for a bearer token.

/** POST /v1/auth/device (no body, no auth). */
export interface AuthDeviceResponse {
  /** Secret; only the desktop sees it. Send it to /v1/auth/token. */
  deviceCode: string;
  /** Shown to the user, e.g. "ABCD-EFGH". */
  userCode: string;
  /** `{origin}/auth/device` */
  verificationUri: string;
  /** `{origin}/auth/device?code=ABCD-EFGH` */
  verificationUriComplete: string;
  /** Seconds until the codes expire. */
  expiresIn: number;
  /** Seconds to wait between polls. */
  interval: number;
}

/** POST /v1/auth/token body. */
export interface AuthTokenRequest {
  deviceCode: string;
}

export const AUTH_TOKEN_ERRORS = ['authorization_pending', 'slow_down', 'expired_token', 'access_denied'] as const;
export type AuthTokenErrorCode = (typeof AUTH_TOKEN_ERRORS)[number];

/** POST /v1/auth/token, status 400. On `slow_down` add 5 s to the poll interval. */
export interface AuthTokenError {
  error: AuthTokenErrorCode;
}

/** The signed-in account. GET /v1/me returns this. */
export interface Account extends Entitlements {
  id: string;
  email: string | null;
  name: string | null;
}

/** POST /v1/auth/token, status 200. The token is issued once; the device code is then used up. */
export interface AuthTokenResponse {
  /** `tyg_…`; send as `Authorization: Bearer <token>`. */
  token: string;
  account: Account;
}

/** GET /v1/me (Bearer). */
export type MeResponse = Account;

export function isAuthTokenError(v: unknown): v is AuthTokenError {
  if (!v || typeof v !== 'object') return false;
  const error = (v as { error?: unknown }).error;
  return typeof error === 'string' && (AUTH_TOKEN_ERRORS as readonly string[]).includes(error);
}

// ---- desktop: what Rust tells the webview (it never sees the token or the device code) ----

export type AuthState = 'signed-in' | 'signed-out' | 'pending' | 'error';

/** Why signing in stopped or couldn't start. Rust also rejects commands with `auth:<code>`. */
export type AuthErrorCode = 'expired' | 'denied' | 'network' | 'server' | 'rate-limited' | 'storage' | 'insecure' | 'keychain';

/** `auth_status()` and the `auth://changed` event. */
export interface AuthStatus {
  state: AuthState;
  signedIn: boolean;
  account?: Account;
  error?: AuthErrorCode;
  /** Signed in, but the API couldn't confirm it just now; `account` is the cached one. */
  offline: boolean;
  /** The API base this state belongs to. */
  apiUrl: string;
}

/** `auth_start()`: what the sign-in dialog shows. */
export interface AuthStart {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
}
