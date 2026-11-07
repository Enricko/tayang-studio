// Browser transport for the self-hosted server: cookie session + CSRF token, JSON-RPC, uploads and
// authenticated asset URLs. No Tauri module is loaded here.

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

export class WebApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'WebApiError';
    this.status = status;
    this.code = code;
  }
}

async function readError(res: Response): Promise<WebApiError> {
  let code = res.status === 401 ? 'unauthorized' : 'server';
  let message = res.statusText || `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    if (body.error) code = body.error;
    if (body.message) message = body.message;
  } catch {
    /* not JSON */
  }
  return new WebApiError(res.status, code, message);
}

/** Reads the session state and refreshes the CSRF token. */
export async function fetchMe(): Promise<{ authenticated: boolean; username: string; csrfToken: string | null }> {
  const res = await fetch('/api/auth/me', { credentials: 'same-origin', headers: { accept: 'application/json' } });
  if (!res.ok) throw await readError(res);
  const me = (await res.json()) as { authenticated: boolean; username: string; csrfToken: string | null };
  setCsrfToken(me.authenticated ? me.csrfToken : null);
  return me;
}

export async function login(password: string): Promise<void> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw await readError(res);
  const body = (await res.json()) as { csrfToken: string };
  setCsrfToken(body.csrfToken);
}

export async function logout(): Promise<void> {
  const token = csrfToken ?? (await fetchMe()).csrfToken;
  const res = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: token ? { 'x-csrf-token': token } : {},
  });
  setCsrfToken(null);
  if (!res.ok && res.status !== 401) throw await readError(res);
}

export async function rpc<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  let token = csrfToken;
  if (!token) token = (await fetchMe()).csrfToken;
  const res = await fetch('/api/rpc', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) },
    body: JSON.stringify({ cmd, args }),
  });
  if (res.status === 401) {
    setCsrfToken(null);
    throw new WebApiError(401, 'unauthorized', 'Your session has ended. Sign in again.');
  }
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

export async function uploadFile<T>(path: string, form: FormData): Promise<T> {
  const token = csrfToken ?? (await fetchMe()).csrfToken;
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: token ? { 'x-csrf-token': token } : {},
    body: form,
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

/** `/api/assets?path=...`, which the server range-serves and authorization-checks. */
export function assetUrl(path: string): string {
  return `/api/assets?path=${encodeURIComponent(path)}`;
}

export async function getCapabilities<T>(): Promise<T> {
  const res = await fetch('/api/capabilities', { credentials: 'same-origin', headers: { accept: 'application/json' } });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}
