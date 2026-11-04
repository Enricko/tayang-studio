import type { Project } from '@tayang/shared';
import { createChat, listChats } from '@/lib/ipc';
import { useApp } from '@/state/app';

/** A project's chat: the latest one, or a fresh one when it has none yet. */
export async function openProjectChat(p: Project): Promise<void> {
  const chats = await listChats(p.id);
  const chat = chats[0] ?? (await createChat(p.id, useApp.getState().settings?.defaultAgent ?? 'claude', p.title));
  useApp.getState().navigate({ name: 'chat', chatId: chat.id });
}
