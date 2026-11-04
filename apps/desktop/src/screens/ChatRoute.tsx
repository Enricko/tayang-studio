import { useEffect } from 'react';
import { getChat } from '@/lib/ipc';
import { ChatNew } from '@/screens/ChatNew';
import { ChatProject } from '@/screens/ChatProject';
import { ChatThread } from '@/screens/ChatThread';
import { useApp } from '@/state/app';
import { useChat } from '@/state/chat';

/** Whether this chat has no project (no preview panel). False while its row is unknown. */
export const useSoloChat = (chatId: string | null) =>
  useChat((s) => {
    const row = chatId ? s.rows[chatId] : undefined;
    return !!row && !row.projectId;
  });

/**
 * The chat screens: New chat, a chat without a project, a project's chat. A chat whose row this
 * session hasn't seen yet opens as a project chat until Rust says otherwise.
 */
export function ChatRoute() {
  const route = useApp((s) => s.route);
  const chatId = route.name === 'chat' ? route.chatId : null;
  const row = useChat((s) => (chatId ? s.rows[chatId] : undefined));

  useEffect(() => {
    if (!chatId || row) return;
    let alive = true;
    getChat(chatId)
      .then((c) => alive && c && useChat.getState().rememberChat(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [chatId, row]);

  if (route.name === 'chat-new') return <ChatNew key="chat-new" />;
  if (route.name !== 'chat') return null;
  if (row && !row.projectId) {
    return <ChatThread key={route.chatId} chatId={route.chatId} draft={route.draft} styleId={route.styleId} />;
  }
  return <ChatProject key={route.chatId} chatId={route.chatId} draft={route.draft} />;
}
