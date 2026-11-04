import type { RecentChat } from '@tayang/shared';
import { isScratchChat } from '@/state/chat';

/** The chats a person opens: no internal ones, and a project once (its most recently active chat). */
export function recentChats(list: RecentChat[]): RecentChat[] {
  const projects = new Set<string>();
  return list.filter((c) => {
    if (isScratchChat(c.id)) return false;
    if (!c.projectId) return true;
    if (projects.has(c.projectId)) return false;
    projects.add(c.projectId);
    return true;
  });
}
