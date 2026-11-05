import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({ updateSettings: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  authStatus: vi.fn(async () => ({ state: 'signed-out', signedIn: false })),
  onAuthChanged: vi.fn(async () => () => {}),
  authStart: vi.fn(),
  authCancel: vi.fn(),
  authLogout: vi.fn(),
  authErrorCode: vi.fn(),
}));

import { updateSettings } from '@/lib/ipc';
import { AccountStep } from '@/screens/onboarding/AccountStep';
import { OnboardingHeader } from '@/components/OnboardingHeader';
import { useApp } from '@/state/app';
import { useAuth } from '@/state/auth';

const settings = (o: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, workingFolder: '/w', ...o });

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ route: { name: 'onboarding-account' }, settings: settings(), leaveGuard: null });
  useAuth.setState({ status: { state: 'signed-out', signedIn: false } as never, flow: { phase: 'closed' } });
});

describe('onboarding: Tayang account step', () => {
  it('is optional: skipping finishes onboarding and opens a new chat', async () => {
    vi.mocked(updateSettings).mockResolvedValue(settings({ onboarded: true }));
    render(<AccountStep />);
    expect(screen.getByRole('heading', { name: 'Sign in to Tayang' })).toBeInTheDocument();
    expect(screen.getByText('Step 4 of 4')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Skip for now/ }));
    expect(updateSettings).toHaveBeenCalledWith({ onboarded: true });
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'chat-new' }));
    expect(useApp.getState().settings?.onboarded).toBe(true);
  });

  it('signs in with Google, then shows the account and starts', async () => {
    const signIn = vi.fn();
    useAuth.setState({ signIn } as never);
    render(<AccountStep />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(signIn).toHaveBeenCalled();
    useAuth.setState({
      status: { state: 'signed-in', signedIn: true, account: { id: 'a', email: 'oyen@example.com', name: 'Oyen', plan: 'free' } } as never,
    });
    expect(await screen.findByText('oyen@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start making videos/ })).toBeInTheDocument();
  });

  it('goes back to the tools step', async () => {
    render(<AccountStep />);
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(useApp.getState().route).toEqual({ name: 'requirements' });
  });

  it('the header counts four steps', () => {
    render(<OnboardingHeader step={2} bars />);
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
  });
});
