import { useEffect } from 'react';
import { create } from 'zustand';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** The left app sidebar: dragging it below `snap` collapses it to the `rail`. */
export const SIDEBAR = { min: 200, max: 360, default: 232, rail: 64, snap: 140 } as const;
/** The project chat's preview panel; its max is also at most `share` of the window. */
export const PREVIEW = { min: 300, max: 720, default: 380, share: 0.55 } as const;
/** The chat column never gets narrower than this while the panels can still give way. */
export const CHAT_MIN = 420;
/** Keyboard step of a resize handle. */
export const STEP = 16;

export interface SavedLayout {
  sidebar: number;
  collapsed: boolean;
  preview: number;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const DEFAULTS: SavedLayout = { sidebar: SIDEBAR.default, collapsed: false, preview: PREVIEW.default };

/** Widths are kept per window: each window has its own key. */
export function layoutKey(): string {
  let label = 'main';
  try {
    label = getCurrentWindow().label || label;
  } catch {
    /* not inside Tauri (tests, a plain browser) */
  }
  return `tayang.layout.${label}`;
}

export function loadLayout(): SavedLayout {
  try {
    const raw = JSON.parse(localStorage.getItem(layoutKey()) ?? 'null') as Partial<SavedLayout> | null;
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    return {
      sidebar: clamp(num(raw.sidebar, DEFAULTS.sidebar), SIDEBAR.min, SIDEBAR.max),
      collapsed: raw.collapsed === true,
      preview: clamp(num(raw.preview, DEFAULTS.preview), PREVIEW.min, PREVIEW.max),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveLayout(s: SavedLayout) {
  try {
    localStorage.setItem(layoutKey(), JSON.stringify({ sidebar: s.sidebar, collapsed: s.collapsed, preview: s.preview }));
  } catch {
    /* storage off or full: the layout still works for this session */
  }
}

interface LayoutState extends SavedLayout {
  windowWidth: number;
  /** A screen with the preview panel is showing. */
  previewOpen: boolean;
  setSidebar(width: number): void;
  setCollapsed(collapsed: boolean): void;
  toggleCollapsed(): void;
  resetSidebar(): void;
  setPreview(width: number): void;
  resetPreview(): void;
  setWindowWidth(width: number): void;
  setPreviewOpen(open: boolean): void;
  /** Reads the saved layout again (startup, tests). */
  hydrate(): void;
}

const viewport = () => (typeof window === 'undefined' ? 1280 : window.innerWidth);

export const useLayout = create<LayoutState>((set, get) => {
  const save = (patch: Partial<SavedLayout>) => {
    set(patch);
    saveLayout(get());
  };
  return {
    ...loadLayout(),
    windowWidth: viewport(),
    previewOpen: false,
    setSidebar: (w) => save({ sidebar: clamp(Math.round(w), SIDEBAR.min, SIDEBAR.max) }),
    setCollapsed: (collapsed) => get().collapsed !== collapsed && save({ collapsed }),
    toggleCollapsed: () => save({ collapsed: !get().collapsed }),
    resetSidebar: () => save({ sidebar: SIDEBAR.default, collapsed: false }),
    setPreview: (w) => save({ preview: clamp(Math.round(w), PREVIEW.min, PREVIEW.max) }),
    resetPreview: () => save({ preview: PREVIEW.default }),
    setWindowWidth: (windowWidth) => set({ windowWidth }),
    setPreviewOpen: (previewOpen) => set({ previewOpen }),
    hydrate: () => set({ ...loadLayout(), windowWidth: viewport() }),
  };
});

export interface FitInput extends SavedLayout {
  windowWidth: number;
  previewOpen: boolean;
}

export interface Fitted {
  /** Width the sidebar takes now (the rail when collapsed). */
  sidebar: number;
  /** Width the preview takes now; 0 when it isn't showing. */
  preview: number;
  /** How wide each handle may drag its panel right now. */
  sidebarMax: number;
  previewMax: number;
}

/**
 * The widths to draw at this window size: the chat keeps `CHAT_MIN`, and when the window is too narrow
 * the preview gives way down to its min first, then the sidebar. Saved widths are never changed by this.
 */
export function fitLayout({ windowWidth: w, sidebar, collapsed, preview, previewOpen }: FitInput): Fitted {
  const previewCap = Math.max(PREVIEW.min, Math.min(PREVIEW.max, Math.floor(w * PREVIEW.share)));
  let s = collapsed ? SIDEBAR.rail : sidebar;
  let p = previewOpen ? Math.min(preview, previewCap) : 0;
  let over = s + p + CHAT_MIN - w;
  if (over > 0 && previewOpen) {
    const cut = Math.min(over, p - PREVIEW.min);
    p -= cut;
    over -= cut;
  }
  if (over > 0 && !collapsed) s -= Math.min(over, s - SIDEBAR.min);
  return {
    sidebar: s,
    preview: p,
    sidebarMax: clamp(w - p - CHAT_MIN, SIDEBAR.min, SIDEBAR.max),
    previewMax: clamp(Math.min(previewCap, w - s - CHAT_MIN), PREVIEW.min, PREVIEW.max),
  };
}

/** The fitted widths, following the window and the saved layout. */
export function useFittedLayout(): Fitted & { collapsed: boolean } {
  const s = useLayout();
  return { ...fitLayout(s), collapsed: s.collapsed };
}

/** Keeps the store's window width current. Mount once. */
export function useWindowWidthSync() {
  useEffect(() => {
    const on = () => useLayout.getState().setWindowWidth(window.innerWidth);
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
}

/** ⌘\ (Ctrl+\ elsewhere) collapses or restores the sidebar. Mount once. */
export function useSidebarShortcut() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key !== '\\' && e.code !== 'Backslash') return;
      e.preventDefault();
      useLayout.getState().toggleCollapsed();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
}
