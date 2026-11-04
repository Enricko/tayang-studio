import type { AgentId } from '@tayang/shared';

export const AGENT_NAMES: Record<AgentId, string> = {
  claude: 'Claude Code',
  opencode: 'opencode',
  gemini: 'Gemini CLI',
  codex: 'Codex',
  custom: 'Your agent',
};

/** What to type in a terminal to sign in to each agent. */
const SIGN_IN_COMMAND: Record<AgentId, string> = {
  claude: 'claude',
  opencode: 'opencode auth login',
  gemini: 'gemini',
  codex: 'codex',
  custom: "your agent's command",
};

export const AGENT_STOPPED = 'The agent stopped unexpectedly';

/** JSON-RPC -32000 is ACP's "authentication required". */
const AUTH = /\bauth|sign[ -]?in|log[ -]?in|-32000/i;

/** What the user sees when the agent fails: its own message, or how to sign in. */
export function agentErrorText(message: string | null | undefined, agent: AgentId): string {
  const msg = (message ?? '').trim();
  if (AUTH.test(msg)) {
    const cmd = SIGN_IN_COMMAND[agent];
    const run = agent === 'custom' ? cmd : `\`${cmd}\``;
    return `Sign in to ${AGENT_NAMES[agent]}: open a terminal and run ${run} once, then try again`;
  }
  return msg || AGENT_STOPPED;
}
