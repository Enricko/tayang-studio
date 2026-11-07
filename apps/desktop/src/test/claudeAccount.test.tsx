import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo, Settings } from '@tayang/shared';

vi.mock('@/lib/claudeAccount', () => ({
  getClaudeAccount: vi.fn(),
  claudeSignIn: vi.fn(),
  claudeSignInCancel: vi.fn().mockResolvedValue(undefined),
  claudeSignOut: vi.fn(),
  onClaudeSignInUrl: vi.fn(),
}));
vi.mock('@/lib/ipc', () => ({
  detectAgents: vi.fn(),
  updateSettings: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));

import * as account from '@/lib/claudeAccount';
import * as ipc from '@/lib/ipc';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ClaudeAccountControl } from '@/components/ClaudeAccountControl';
import { Connect } from '@/screens/onboarding/Connect';
import { useApp } from '@/state/app';
import { useClaudeAccount } from '@/state/claudeAccount';

const out = { signedIn: false, email: null, plan: null };
const signedIn = { signedIn: true, email: 'kreator@contoh.id', plan: 'pro' };

const settings = { defaultAgent: 'opencode' } as Settings;
const claude: AgentInfo = { id: 'claude', name: 'Claude Code', installed: true, version: '2.1.3', recommended: true, acpCommand: [] } as AgentInfo;

let urlCb: ((url: string) => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  useClaudeAccount.setState({ account: null, signingIn: false, url: null, error: null });
  urlCb = null;
  vi.mocked(account.onClaudeSignInUrl).mockImplementation(async (cb) => {
    urlCb = cb;
    return () => {};
  });
});

describe('ClaudeAccountControl', () => {
  it('signs in through the browser, offers the page if it did not open, and reports the account', async () => {
    vi.mocked(account.getClaudeAccount).mockResolvedValue(out);
    let finish: (a: typeof signedIn) => void = () => {};
    vi.mocked(account.claudeSignIn).mockReturnValue(new Promise((r) => (finish = r)));
    const onSignedIn = vi.fn();
    render(<ClaudeAccountControl onSignedIn={onSignedIn} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Sign in to Claude' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Finish signing in in your browser…');
    act(() => urlCb?.('https://claude.com/cai/oauth/authorize?x=1'));
    await userEvent.click(await screen.findByRole('button', { name: "Browser didn't open? Open the sign-in page" }));
    expect(openUrl).toHaveBeenCalledWith('https://claude.com/cai/oauth/authorize?x=1');

    await act(async () => finish(signedIn));
    expect(await screen.findByText('Signed in as kreator@contoh.id')).toBeInTheDocument();
    expect(onSignedIn).toHaveBeenCalledOnce();
  });

  it('cancelling is quiet, and a failure says why', async () => {
    vi.mocked(account.getClaudeAccount).mockResolvedValue(out);
    vi.mocked(account.claudeSignIn).mockRejectedValueOnce('cancelled');
    render(<ClaudeAccountControl />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in to Claude' }));
    await screen.findByRole('button', { name: 'Sign in to Claude' });
    expect(screen.queryByRole('alert')).toBeNull();

    vi.mocked(account.claudeSignIn).mockRejectedValueOnce('Signing in took too long. Try again');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in to Claude' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't sign in: Signing in took too long. Try again");
  });

  it('signs out from Settings', async () => {
    vi.mocked(account.getClaudeAccount).mockResolvedValue(signedIn);
    vi.mocked(account.claudeSignOut).mockResolvedValue(out);
    render(<ClaudeAccountControl showSignOut />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Sign in to Claude' })).toBeInTheDocument();
  });
});

describe('Connect', () => {
  it('asks to sign in to Claude before it counts as connected, then connects it', async () => {
    vi.mocked(ipc.detectAgents).mockResolvedValue([claude]);
    vi.mocked(account.getClaudeAccount).mockResolvedValue(out);
    vi.mocked(account.claudeSignIn).mockResolvedValue(signedIn);
    vi.mocked(ipc.updateSettings).mockResolvedValue({ ...settings, defaultAgent: 'claude' });
    useApp.setState({ settings: { ...settings, defaultAgent: 'claude' }, route: { name: 'connect' } });
    render(<Connect />);

    const signIn = await screen.findByRole('button', { name: 'Sign in to Claude' });
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled();
    await userEvent.click(signIn);
    await waitFor(() => expect(ipc.updateSettings).toHaveBeenCalledWith({ defaultAgent: 'claude' }));
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/ })).toBeEnabled();
  });
});
