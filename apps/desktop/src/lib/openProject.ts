import type { AgentId, MessagePart, Project } from '@tayang/shared';
import { SKIP_FRAME_CHECK } from '@tayang/skills';
import { i18n } from '@/i18n';
import { slotTime } from '@/lib/autopilot';
import { createChat, listChats } from '@/lib/ipc';
import { localClock } from '@/lib/time';
import { useApp } from '@/state/app';
import { appendSystem, BUSY_NOTE, useChat, type SendOpts } from '@/state/chat';

/** The project's latest chat, or a fresh one when it has none yet. */
async function projectChat(p: Project) {
  const chats = await listChats(p.id);
  return chats[0] ?? (await createChat(p.id, useApp.getState().settings?.defaultAgent ?? 'claude', p.title));
}

/** A project's chat: the latest one, or a fresh one when it has none yet. */
export async function openProjectChat(p: Project): Promise<void> {
  const chat = await projectChat(p);
  useApp.getState().navigate({ name: 'chat', chatId: chat.id });
}

/** What every send in a project chat carries: its agent, its build job, and the skip line when the frame check is off. */
export function projectSendOptions(project: Pick<Project, 'id' | 'title'> | null, agentId: AgentId, prompt: MessagePart[]): SendOpts {
  // The brief's frame check applies to projects made while it was on; this covers turning it off later.
  const skip = useApp.getState().settings?.frameCheck === false;
  return {
    job: project ? { projectId: project.id, title: project.title } : undefined,
    agentId,
    ...(skip ? { promptParts: [{ type: 'text', text: SKIP_FRAME_CHECK }, ...prompt] } : {}),
  };
}

/**
 * "Let the agent pick": opens the video's chat and asks its agent, as the user, for the best posting
 * time in the next 7 days as a schedule card. While a turn is running there it only says to wait.
 * `onOpen` runs once the chat is found, just before it opens; a chat that can't be found rejects first.
 */
export async function askAgentToSchedule(p: Project, onOpen?: () => void): Promise<void> {
  const chat = await projectChat(p);
  onOpen?.();
  useApp.getState().navigate({ name: 'chat', chatId: chat.id });
  const store = useChat.getState();
  store.listen();
  // The conversation must be in memory before anything is added to it, or the chat would open without its history.
  await store.load(chat.id);
  if (useChat.getState().streaming[chat.id]) {
    await appendSystem(chat.id, BUSY_NOTE);
    return;
  }
  const { timeZone, offset } = localClock();
  const ask: MessagePart[] = [
    { type: 'text', text: i18n.t('schedule.agentPrompt', { now: slotTime(new Date()), zone: `${timeZone}, UTC${offset}` }) },
  ];
  await useChat.getState().send(chat.id, ask, projectSendOptions(p, chat.agentId, ask));
}
