import { describe, expect, it } from 'vitest';
import { agentErrorText } from '@/lib/agents';

describe('agentErrorText', () => {
  it('shows the agent message when there is one', () => {
    expect(agentErrorText('The agent reported an error: quota exceeded', 'claude')).toBe(
      'The agent reported an error: quota exceeded',
    );
    expect(agentErrorText('', 'claude')).toBe('The agent stopped unexpectedly');
    expect(agentErrorText(undefined, 'gemini')).toBe('The agent stopped unexpectedly');
  });

  it.each([
    'Authentication required',
    'Please sign in',
    'not logged in: run /login',
    'The agent could not start a session: oops (code -32000)',
  ])('maps "%s" to sign-in copy', (msg) => {
    expect(agentErrorText(msg, 'claude')).toBe(
      'Sign in to Claude Code: open a terminal and run `claude` once, then try again',
    );
  });

  it("names the agent's own command", () => {
    expect(agentErrorText('auth required', 'gemini')).toBe(
      'Sign in to Gemini CLI: open a terminal and run `gemini` once, then try again',
    );
  });
});
