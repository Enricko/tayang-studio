import type { AgentId } from '@tayang/shared';

export const AGENT_NAMES: Record<AgentId, string> = {
  claude: 'Claude Code',
  opencode: 'opencode',
  gemini: 'Gemini CLI',
  codex: 'Codex',
  custom: 'Your agent',
};
