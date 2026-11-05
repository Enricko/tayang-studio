import type { A2uiAction } from '@/a2ui/render';
import type { AgentAction } from '@/lib/events';

/** An agent's /video or /schedule request in the shape the topic and schedule flows already take. */
export const asAction = (a: AgentAction): A2uiAction => ({
  name: a.name,
  surfaceId: 'agent',
  sourceComponentId: '',
  timestamp: new Date().toISOString(),
  context: a.context,
  summary: '',
});
