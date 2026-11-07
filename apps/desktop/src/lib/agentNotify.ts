import { canNotify, notify } from '@/lib/platform';
import { i18n } from '@/i18n';
import { listRecentChats } from '@/lib/ipc';
import { useApp } from '@/state/app';

/** What happened in a chat that is worth a system notification. */
export type AgentEvent = 'done' | 'asks' | 'permission';

/** The user is looking at this chat right now: the window has focus and the chat is open. */
function watching(chatId: string): boolean {
  const route = useApp.getState().route;
  const open = route.name === 'chat' && route.chatId === chatId;
  return open && typeof document !== 'undefined' && document.hasFocus();
}

/** The chat's name as the sidebar shows it: its video's title, else its own. */
async function chatName(chatId: string): Promise<string | null> {
  try {
    const c = (await listRecentChats(50)).find((r) => r.id === chatId);
    return c ? (c.projectTitle ?? c.title) : null;
  } catch {
    return null;
  }
}

/**
 * Tells the user, with a system notification, that an agent finished, is waiting for them to pick
 * something, or asks to run a command, unless they are already looking at that chat. Never asks for
 * the permission itself (the scheduler's reminders do that the first time); never throws.
 */
export async function notifyAgent(chatId: string, event: AgentEvent): Promise<void> {
  if (watching(chatId)) return;
  try {
    if (!(await canNotify())) return;
    const name = (await chatName(chatId)) ?? i18n.t('agentNotify.aChat');
    const title = i18n.t(`agentNotify.${event}.title`);
    const body = i18n.t(`agentNotify.${event}.body`, { name });
    await notify(title, body);
  } catch {
    /* a missed notification is not worth an error */
  }
}
