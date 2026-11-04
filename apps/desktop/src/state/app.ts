import { create } from 'zustand';
import type { PaidPlanId, Settings } from '@tayang/shared';

export type Route =
  | { name: 'welcome' }
  | { name: 'connect' }
  | { name: 'requirements' }
  | { name: 'chat-new'; styleId?: string }
  | { name: 'chat'; chatId: string; /** Prefilled in the composer, never sent. */ draft?: string }
  | { name: 'videos' }
  | { name: 'style'; /** Focus the link box when the screen opens. */ focusLink?: boolean }
  | { name: 'autopilot'; /** One autopilot's detail view. */ id?: string }
  | { name: 'autopilot-wizard'; /** Editing this autopilot; none for a new one. */ id?: string }
  | { name: 'agents' }
  | { name: 'calendar' }
  | { name: 'settings' }
  /** Full window, like onboarding. `from` is where Back returns to; `plan` is picked first. */
  | { name: 'plans'; from?: 'settings' | 'autopilot'; plan?: PaidPlanId };

/** Asked before every navigation while set; returning false keeps the current screen (it asks the user itself). */
export type LeaveGuard = (next: Route) => boolean;

interface AppState {
  route: Route;
  navigate(r: Route): void;
  leaveGuard: LeaveGuard | null;
  setLeaveGuard(guard: LeaveGuard | null): void;
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

export const useApp = create<AppState>((set, get) => ({
  route: { name: 'welcome' },
  navigate: (route) => {
    const guard = get().leaveGuard;
    if (guard && !guard(route)) return;
    set({ route });
  },
  leaveGuard: null,
  setLeaveGuard: (leaveGuard) => set({ leaveGuard }),
  settings: null,
  setSettings: (settings) => set({ settings }),
  needsYouCount: 0,
  projectsVersion: 0,
  bumpProjects: () => set((s) => ({ projectsVersion: s.projectsVersion + 1 })),
  notificationsBlocked: false,
  setNotificationsBlocked: (notificationsBlocked) => set({ notificationsBlocked }),
}));
