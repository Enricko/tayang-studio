import type { AgentId } from '@tayang/shared';
import { i18n } from '@/i18n';

export const AGENT_NAMES: Record<AgentId, string> = {
  claude: 'Claude Code',
  opencode: 'opencode',
  gemini: 'Gemini CLI',
  codex: 'Codex',
  /** The only name that is a phrase, not a brand: it follows the language. */
  get custom() {
    return i18n.t('agents.yourAgent');
  },
};

/** What to type in a terminal to sign in to each agent. */
const SIGN_IN_COMMAND: Record<AgentId, string> = {
  claude: 'claude',
  opencode: 'opencode auth login',
  gemini: 'gemini',
  codex: 'codex',
  custom: '',
};

/** JSON-RPC -32000 is ACP's "authentication required". */
const AUTH = /\bauth|sign[ -]?in|log[ -]?in|-32000/i;

/** What the user sees when the agent fails: its own message, or how to sign in.
 * `lng: 'en'` gives the English text that gets saved with a chat or job (see `lib/stored.ts`). */
export function agentErrorText(message: string | null | undefined, agent: AgentId, lng?: 'en'): string {
  const msg = (message ?? '').trim();
  if (AUTH.test(msg)) {
    const opts = lng ? { lng } : {};
    const cmd = SIGN_IN_COMMAND[agent] || i18n.t('errors.yourAgentCommand', opts);
    const run = agent === 'custom' ? cmd : `\`${cmd}\``;
    const name = agent === 'custom' ? i18n.t('agents.yourAgent', opts) : AGENT_NAMES[agent];
    return i18n.t('errors.signIn', { agent: name, command: run, ...opts });
  }
  return msg || i18n.t('errors.agentStopped', lng ? { lng } : {});
}

/** The note Rust writes on a job whose agent died with the app (`fail_stale_jobs`). */
export const CLOSED_NOTE = 'Tayang was closed while this was running';
/** The draft prefilled (never sent) when a chat job failed because Tayang was closed is `agents.closedDraft`. */
