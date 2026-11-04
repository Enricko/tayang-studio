import { useEffect, useState } from 'react';
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
 * session hasn't seen yet waits for Rust's answer, so it never opens in the wrong layout; one Rust
 * doesn't know opens as a project chat, as before.
 */
export function ChatRoute() {
  const route = useApp((s) => s.route);
  const chatId = route.name === 'chat' ? route.chatId : null;
  const row = useChat((s) => (chatId ? s.rows[chatId] : undefined));
  /** The chat whose lookup came back without a row (or failed). */
  const [missing, setMissing] = useState<string | null>(null);

  useEffect(() => {
    if (!chatId || row) return;
    let alive = true;
    getChat(chatId)
      .then((c) => alive && (c ? useChat.getState().rememberChat(c) : setMissing(chatId)))
      .catch(() => alive && setMissing(chatId));
    return () => {
      alive = false;
    };
  }, [chatId, row]);

  if (route.name === 'chat-new') return <ChatNew key="chat-new" />;
  if (route.name !== 'chat') return null;
  if (!row && missing !== route.chatId) return null;
  if (row && !row.projectId) {
    return <ChatThread key={route.chatId} chatId={route.chatId} draft={route.draft} styleId={route.styleId} />;
  }
  return <ChatProject key={route.chatId} chatId={route.chatId} draft={route.draft} />;
}
