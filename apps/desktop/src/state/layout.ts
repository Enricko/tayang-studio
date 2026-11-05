import { useEffect } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** The left app sidebar: dragging it below `snap` collapses it to the `rail`. */
export const SIDEBAR = { min: 200, max: 360, default: 232, rail: 64, snap: 140 } as const;
/** The project chat's preview panel; its max is also at most `share` of the window. */
export const PREVIEW = { min: 300, max: 720, default: 380, share: 0.55 } as const;
/** The project chat's file sidebar on the right; it can be closed. */
export const FILES = { min: 200, max: 420, default: 260 } as const;
/** The chat column never gets narrower than this while the panels can still give way. */
export const CHAT_MIN = 420;
/** Keyboard step of a resize handle. */
export const STEP = 16;

export interface SavedLayout {
  sidebar: number;
  collapsed: boolean;
  preview: number;
  files: number;
  filesOpen: boolean;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const DEFAULTS: SavedLayout = {
  sidebar: SIDEBAR.default,
  collapsed: false,
  preview: PREVIEW.default,
  files: FILES.default,
  filesOpen: true,
};

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
      files: clamp(num(raw.files, DEFAULTS.files), FILES.min, FILES.max),
      filesOpen: raw.filesOpen !== false,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveLayout(s: SavedLayout) {
  try {
    const { sidebar, collapsed, preview, files, filesOpen } = s;
    localStorage.setItem(layoutKey(), JSON.stringify({ sidebar, collapsed, preview, files, filesOpen }));
  } catch {
    /* storage off or full: the layout still works for this session */
  }
}

interface LayoutState extends SavedLayout {
  windowWidth: number;
  /** `live`: mid-drag, shown but not saved yet (the drag's final call saves). */
  setSidebar(width: number, live?: boolean): void;
  setCollapsed(collapsed: boolean, live?: boolean): void;
  toggleCollapsed(): void;
  resetSidebar(): void;
  setPreview(width: number, live?: boolean): void;
  resetPreview(): void;
  setFiles(width: number, live?: boolean): void;
  resetFiles(): void;
  toggleFiles(): void;
  setWindowWidth(width: number): void;
  /** Reads the saved layout again (startup, tests). */
  hydrate(): void;
}

const viewport = () => (typeof window === 'undefined' ? 1280 : window.innerWidth);

export const useLayout = create<LayoutState>((set, get) => {
  const save = (patch: Partial<SavedLayout>, live = false) => {
    set(patch);
    if (!live) saveLayout(get());
  };
  return {
    ...loadLayout(),
    windowWidth: viewport(),
    setSidebar: (w, live) => save({ sidebar: clamp(Math.round(w), SIDEBAR.min, SIDEBAR.max) }, live),
    setCollapsed: (collapsed, live) => (get().collapsed !== collapsed || !live) && save({ collapsed }, live),
    toggleCollapsed: () => save({ collapsed: !get().collapsed }),
    resetSidebar: () => save({ sidebar: SIDEBAR.default, collapsed: false }),
    setPreview: (w, live) => save({ preview: clamp(Math.round(w), PREVIEW.min, PREVIEW.max) }, live),
    resetPreview: () => save({ preview: PREVIEW.default }),
    setFiles: (w, live) => save({ files: clamp(Math.round(w), FILES.min, FILES.max) }, live),
    resetFiles: () => save({ files: FILES.default }),
    toggleFiles: () => save({ filesOpen: !get().filesOpen }),
    setWindowWidth: (windowWidth) => set({ windowWidth }),
    hydrate: () => set({ ...loadLayout(), windowWidth: viewport() }),
  };
});

export interface FitInput extends Omit<SavedLayout, 'files' | 'filesOpen'> {
  windowWidth: number;
  /** The screen shows the preview panel (the project chat). */
  previewOpen: boolean;
  /** The project chat's file sidebar width, and whether it shows (only with the preview). */
  files?: number;
  filesOpen?: boolean;
}

export interface Fitted {
  /** Width the sidebar takes now (the rail when collapsed). */
  sidebar: number;
  /** Width the preview takes now; 0 when it isn't showing. */
  preview: number;
  /** Width the file sidebar takes now; 0 when it isn't showing. */
  files: number;
  /** How wide each handle may drag its panel right now. */
  sidebarMax: number;
  previewMax: number;
  filesMax: number;
}

/**
 * The widths to draw at this window size: the chat keeps `CHAT_MIN`, and when the window is too narrow
 * the preview gives way down to its min first, then the file sidebar, then the app sidebar. Saved widths
 * are never changed by this.
 */
export function fitLayout({
  windowWidth: w,
  sidebar,
  collapsed,
  preview,
  previewOpen,
  files = FILES.default,
  filesOpen = false,
}: FitInput): Fitted {
  const withFiles = previewOpen && filesOpen;
  const previewCap = Math.max(PREVIEW.min, Math.min(PREVIEW.max, Math.floor(w * PREVIEW.share)));
  let s = collapsed ? SIDEBAR.rail : sidebar;
  let p = previewOpen ? Math.min(preview, previewCap) : 0;
  let f = withFiles ? files : 0;
  let over = s + p + f + CHAT_MIN - w;
  if (over > 0 && previewOpen) {
    const cut = Math.min(over, p - PREVIEW.min);
    p -= cut;
    over -= cut;
  }
  if (over > 0 && withFiles) {
    const cut = Math.min(over, f - FILES.min);
    f -= cut;
    over -= cut;
  }
  if (over > 0 && !collapsed) s -= Math.min(over, s - SIDEBAR.min);
  return {
    sidebar: s,
    preview: p,
    files: f,
    // A wider sidebar may push the panels down to their mins (they give way first), never the chat.
    sidebarMax: clamp(w - (previewOpen ? PREVIEW.min : 0) - (withFiles ? FILES.min : 0) - CHAT_MIN, SIDEBAR.min, SIDEBAR.max),
    previewMax: clamp(Math.min(previewCap, w - s - f - CHAT_MIN), PREVIEW.min, PREVIEW.max),
    filesMax: clamp(w - s - p - CHAT_MIN, FILES.min, FILES.max),
  };
}

/**
 * The fitted widths, following the window and the saved layout, for a screen with or without the preview.
 * The file sidebar only shows next to the preview (the project chat).
 */
export function useFittedLayout(previewOpen: boolean): Fitted & { collapsed: boolean } {
  const s = useLayout(
    useShallow(({ sidebar, collapsed, preview, files, filesOpen, windowWidth }) => ({
      sidebar,
      collapsed,
      preview,
      files,
      filesOpen,
      windowWidth,
    })),
  );
  return { ...fitLayout({ ...s, previewOpen }), collapsed: s.collapsed };
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

const isMac = () => typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** ⌘\ (Ctrl+\ elsewhere) collapses or restores the sidebar. Mount once. */
export function useSidebarShortcut() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(isMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key !== '\\' && e.code !== 'Backslash') return;
      // Not while typing, holding the keys down, or with a dialog in front.
      if (e.repeat || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest(TYPING)) return;
      if (document.querySelector('[role=dialog][aria-modal=true], [role=alertdialog][aria-modal=true]')) return;
      e.preventDefault();
      useLayout.getState().toggleCollapsed();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
}
