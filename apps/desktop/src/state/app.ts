import { create } from 'zustand';
import type { Settings } from '@tayang/shared';

export type Route =
  | { name: 'welcome' }
  | { name: 'connect' }
  | { name: 'requirements' }
  | { name: 'chat-new'; styleId?: string }
  | { name: 'chat'; chatId: string; /** Prefilled in the composer, never sent. */ draft?: string }
  | { name: 'videos' }
  | { name: 'style'; /** Focus the link box when the screen opens. */ focusLink?: boolean }
  | { name: 'agents' }
  | { name: 'calendar' }
  | { name: 'settings' };

interface AppState {
  route: Route;
  navigate(r: Route): void;
  settings: Settings | null;
  setSettings(s: Settings): void;
  needsYouCount: number;
  /** Bumped when a project is created so the sidebar's Recent list refreshes. */
  projectsVersion: number;
  bumpProjects(): void;
  /** Set when a reminder was due but the system denied notifications; the Calendar explains it. */
  notificationsBlocked: boolean;
  setNotificationsBlocked(blocked: boolean): void;
}

export const useApp = create<AppState>((set) => ({
  route: { name: 'welcome' },
  navigate: (route) => set({ route }),
  settings: null,
  setSettings: (settings) => set({ settings }),
  needsYouCount: 0,
  projectsVersion: 0,
  bumpProjects: () => set((s) => ({ projectsVersion: s.projectsVersion + 1 })),
  notificationsBlocked: false,
  setNotificationsBlocked: (notificationsBlocked) => set({ notificationsBlocked }),
}));
