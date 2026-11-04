import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthStatus } from '@tayang/shared';

const handlers: ((s: AuthStatus) => void)[] = [];
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  authStart: vi.fn(),
  authCancel: vi.fn().mockResolvedValue(undefined),
  authStatus: vi.fn(),
  authLogout: vi.fn(),
  onAuthChanged: vi.fn(async (cb: (s: AuthStatus) => void) => {
    handlers.push(cb);
    return () => {};
  }),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));

import { openUrl } from '@tauri-apps/plugin-opener';
import { AccountSection } from '@/components/Account';
import { setUiLanguage } from '@/i18n';
import * as auth from '@/lib/auth';
import { authErrorCode } from '@/lib/auth';
import { useAuth } from '@/state/auth';

const API = 'http://localhost:8787/api';
const signedOut: AuthStatus = { state: 'signed-out', signedIn: false, offline: false, apiUrl: API };
const signedIn: AuthStatus = {
  state: 'signed-in',
  signedIn: true,
  offline: false,
  apiUrl: API,
  account: { id: 'acc_1', email: 'ana@example.com', name: 'Ana Putri', plan: 'pro', features: ['voiceover'] },
};
const started = {
  userCode: 'ABCD-EFGH',
  verificationUri: `${API}/auth/device`,
  verificationUriComplete: `${API}/auth/device?code=ABCD-EFGH`,
  expiresIn: 600,
};

const emit = (s: AuthStatus) => act(() => handlers.forEach((h) => h(s)));

beforeEach(() => {
  vi.clearAllMocks();
  handlers.length = 0;
  useAuth.setState(useAuth.getInitialState(), true);
  vi.mocked(auth.authStatus).mockResolvedValue(signedOut);
  vi.mocked(auth.authStart).mockResolvedValue(started);
  vi.mocked(auth.authLogout).mockResolvedValue(undefined);
});

async function openDialog() {
  render(<AccountSection />);
  await userEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
  return screen.findByRole('dialog');
}

describe('authErrorCode', () => {
  it('reads auth:<code> rejections only', () => {
    expect(authErrorCode('auth:rate-limited')).toBe('rate-limited');
    expect(authErrorCode(new Error('auth:network'))).toBe('network');
    expect(authErrorCode('auth:cancelled')).toBe('cancelled');
    expect(authErrorCode('auth:insecure')).toBe('insecure');
    expect(authErrorCode('auth:whatever')).toBeNull();
    expect(authErrorCode('boom')).toBeNull();
  });
});

describe('Sign in with Google', () => {
  it('shows the code from Rust, and opens the browser again on request', async () => {
    const dialog = await openDialog();
    expect(auth.authStart).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByText('Finish signing in in your browser')).toBeInTheDocument();
    expect(await within(dialog).findByText('ABCD-EFGH')).toBeInTheDocument();
    expect(openUrl).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open browser again' }));
    expect(openUrl).toHaveBeenCalledWith(started.verificationUriComplete);
  });

  it('never opens tayang.app', async () => {
    await openDialog();
    expect(openUrl).not.toHaveBeenCalledWith(expect.stringContaining('tayang.app'));
  });

  it('cancel stops signing in and closes the dialog', async () => {
    const dialog = await openDialog();
    await within(dialog).findByText('ABCD-EFGH');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(auth.authCancel).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes on success and shows the account card', async () => {
    const dialog = await openDialog();
    await within(dialog).findByText('ABCD-EFGH');
    emit({ ...signedOut, state: 'pending' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    emit(signedIn);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Ana Putri')).toBeInTheDocument();
    expect(screen.getByText('ana@example.com')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('AP')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).not.toBeInTheDocument();
  });

  it('a sign-in that finishes before the code arrives does not reopen the dialog', async () => {
    let resolve!: (v: typeof started) => void;
    vi.mocked(auth.authStart).mockReturnValue(new Promise((r) => (resolve = r)));
    await openDialog();
    emit(signedIn);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await act(async () => resolve(started));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows an unreachable API with its address, and tries again', async () => {
    vi.mocked(auth.authStart).mockRejectedValueOnce('auth:network');
    const dialog = await openDialog();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(`Can't reach the Tayang API at ${API}`);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(auth.authStart).toHaveBeenCalledTimes(2);
    expect(await within(dialog).findByText('ABCD-EFGH')).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    ['expired', 'The code ran out before you finished'],
    ['denied', 'Signing in was cancelled in the browser'],
    ['server', `The Tayang API at ${API} answered something unexpected`],
    ['rate-limited', 'Too many sign-in attempts'],
    ['storage', "couldn't keep your sign-in on this computer"],
  ] as const)('shows %s from the poller with Try again', async (error, text) => {
    const dialog = await openDialog();
    await within(dialog).findByText('ABCD-EFGH');
    emit({ ...signedOut, state: 'error', error });
    expect(within(dialog).getByRole('alert')).toHaveTextContent(text);
    expect(within(dialog).queryByText('ABCD-EFGH')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(auth.authStart).toHaveBeenCalledTimes(2);
  });

  it('says plain http to another computer is not safe for signing in', async () => {
    vi.mocked(auth.authStart).mockRejectedValueOnce('auth:insecure');
    const dialog = await openDialog();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Signing in needs a secure (https) API address');
  });

  it('shows an unexpected failure as it came', async () => {
    vi.mocked(auth.authStart).mockRejectedValueOnce(new Error('state not managed'));
    const dialog = await openDialog();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('state not managed');
  });
});

describe('Account card', () => {
  it('shows the cached account as offline', async () => {
    vi.mocked(auth.authStatus).mockResolvedValue({ ...signedIn, offline: true });
    render(<AccountSection />);
    expect(await screen.findByText('Ana Putri')).toBeInTheDocument();
    expect(screen.getByText(/Offline/)).toBeInTheDocument();
  });

  it('falls back to the email, and a free plan says Free', async () => {
    vi.mocked(auth.authStatus).mockResolvedValue({ ...signedIn, account: { ...signedIn.account!, name: null, plan: 'free' } });
    render(<AccountSection />);
    expect(await screen.findByText('Free')).toBeInTheDocument();
    expect(screen.getAllByText('ana@example.com').length).toBeGreaterThan(0);
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('sign out asks first, then signs out', async () => {
    vi.mocked(auth.authStatus).mockResolvedValue(signedIn);
    render(<AccountSection />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    let confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText('Sign out of Tayang?')).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(auth.authLogout).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    confirm = await screen.findByRole('dialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Sign out' }));
    expect(auth.authLogout).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    emit(signedOut);
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
  });

  it('says when signing out fails', async () => {
    vi.mocked(auth.authStatus).mockResolvedValue(signedIn);
    vi.mocked(auth.authLogout).mockRejectedValueOnce('auth:storage');
    render(<AccountSection />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    const confirm = await screen.findByRole('dialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Sign out' }));
    expect(await within(confirm).findByRole('alert')).toHaveTextContent("couldn't remove your sign-in from this computer");
  });
});

describe('Account in Indonesian', () => {
  it('speaks Indonesian in the card and the dialog', async () => {
    setUiLanguage('id');
    render(<AccountSection />);
    await userEvent.click(await screen.findByRole('button', { name: 'Masuk dengan Google' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Selesaikan masuk di browser')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Buka browser lagi' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Batal' })).toBeInTheDocument();
    emit({ ...signedOut, state: 'error', error: 'expired' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Kodenya kedaluwarsa');
    emit(signedIn);
    await userEvent.click(await screen.findByRole('button', { name: 'Keluar' }));
    expect(await screen.findByText('Keluar dari Tayang?')).toBeInTheDocument();
  });
});
