/** English UI strings: the source of truth. `id.ts` must have exactly the same keys. */
export const en = {
  app: {
    settingsFailed: "Tayang couldn't load your settings",
  },
  common: {
    tryAgain: 'Try again',
    cancel: 'Cancel',
  },
  sidebar: {
    main: 'Main',
    studio: 'Studio',
    newChat: 'New chat',
    chat: 'Chat',
    videos: 'Videos',
    style: 'Style',
    agents: 'Agents',
    calendar: 'Calendar',
    settings: 'Settings',
    recent: 'Recent',
  },
} as const;

type Widen<T> = { -readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
/** The shape every language must match: same keys, string values. */
export type Translations = Widen<typeof en>;
