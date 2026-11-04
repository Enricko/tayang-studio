import { create } from 'zustand';
import type { Settings } from '@tayang/shared';

export type Route =
  | { name: 'welcome' }
  | { name: 'connect' }
  | { name: 'requirements' }
  | { name: 'chat-new' }
  | { name: 'chat'; chatId: string }
  | { name: 'videos' }
  | { name: 'style' }
  | { name: 'agents' }
  | { name: 'calendar' }
  | { name: 'settings' };

interface AppState {
  route: Route;
  navigate(r: Route): void;
  settings: Settings | null;
  setSettings(s: Settings): void;
  needsYouCount: number;
}

export const useApp = create<AppState>((set) => ({
  route: { name: 'welcome' },
  navigate: (route) => set({ route }),
  settings: null,
  setSettings: (settings) => set({ settings }),
  needsYouCount: 0,
}));
