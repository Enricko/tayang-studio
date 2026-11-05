import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_MIN, FILES, PREVIEW, SIDEBAR, fitLayout, layoutKey, loadLayout, useLayout } from '@/state/layout';

const KEY = layoutKey();
/** The file sidebar's saved part when nothing about it was saved. */
const F = { files: FILES.default, filesOpen: true };

describe('layout persistence', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('starts from the defaults when nothing is saved', () => {
    expect(loadLayout()).toEqual({ sidebar: SIDEBAR.default, collapsed: false, preview: PREVIEW.default, ...F });
  });

  it('reads saved widths, clamped to their limits', () => {
    localStorage.setItem(KEY, JSON.stringify({ sidebar: 300, collapsed: true, preview: 9999 }));
    expect(loadLayout()).toEqual({ sidebar: 300, collapsed: true, preview: PREVIEW.max, ...F });
  });

  it('ignores junk', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadLayout()).toEqual({ sidebar: SIDEBAR.default, collapsed: false, preview: PREVIEW.default, ...F });
    localStorage.setItem(KEY, JSON.stringify({ sidebar: 'wide', collapsed: 1 }));
    expect(loadLayout()).toEqual({ sidebar: SIDEBAR.default, collapsed: false, preview: PREVIEW.default, ...F });
  });

  it('writes every change', () => {
    useLayout.getState().hydrate();
    useLayout.getState().setSidebar(280);
    useLayout.getState().setPreview(500);
    useLayout.getState().setCollapsed(true);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ sidebar: 280, collapsed: true, preview: 500, ...F });
  });

  it('does not write while a drag is live, only its final width', () => {
    useLayout.getState().hydrate();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    useLayout.getState().setSidebar(250, true);
    useLayout.getState().setCollapsed(true, true);
    useLayout.getState().setPreview(450, true);
    expect(setItem).not.toHaveBeenCalled();
    expect(useLayout.getState()).toMatchObject({ sidebar: 250, collapsed: true, preview: 450 });
    useLayout.getState().setPreview(460);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ sidebar: 250, collapsed: true, preview: 460, ...F });
  });

  it('works when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadLayout()).toEqual({ sidebar: SIDEBAR.default, collapsed: false, preview: PREVIEW.default, ...F });
    useLayout.getState().hydrate();
    expect(() => useLayout.getState().setSidebar(300)).not.toThrow();
    expect(useLayout.getState().sidebar).toBe(300);
  });
});

describe('the file sidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    useLayout.getState().hydrate();
  });

  it('is saved with its width and whether it is open, clamped', () => {
    useLayout.getState().setFiles(9999);
    useLayout.getState().toggleFiles();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ files: FILES.max, filesOpen: false });
    localStorage.setItem(KEY, JSON.stringify({ files: 10, filesOpen: 'yes' }));
    expect(loadLayout()).toMatchObject({ files: FILES.min, filesOpen: true });
  });

  it('shows only next to the preview, and gives way after the preview but before the app sidebar', () => {
    const base = { sidebar: 232, collapsed: false, preview: 380, files: 260, filesOpen: true };
    expect(fitLayout({ ...base, windowWidth: 1600, previewOpen: false }).files).toBe(0);
    const wide = fitLayout({ ...base, windowWidth: 1600, previewOpen: true });
    expect(wide).toMatchObject({ sidebar: 232, preview: 380, files: 260 });
    // 232 + 380 + 260 + 420 = 1292: 12px short, taken from the preview.
    expect(fitLayout({ ...base, windowWidth: 1280, previewOpen: true })).toMatchObject({ preview: 368, files: 260, sidebar: 232 });
    // Narrower: the preview hits its min, then the files give way, then the app sidebar.
    const tight = fitLayout({ ...base, windowWidth: 1100, previewOpen: true });
    expect(tight.preview).toBe(PREVIEW.min);
    expect(tight.files).toBe(FILES.min);
    // Every panel at its min: narrower than this the window can't fit them all.
    expect(tight.sidebar).toBe(SIDEBAR.min);
    // Closed, it takes nothing.
    expect(fitLayout({ ...base, filesOpen: false, windowWidth: 1280, previewOpen: true })).toMatchObject({ files: 0, preview: 380 });
  });
});

describe('layout store', () => {
  beforeEach(() => {
    localStorage.clear();
    useLayout.getState().hydrate();
  });

  it('clamps widths to their limits', () => {
    useLayout.getState().setSidebar(50);
    expect(useLayout.getState().sidebar).toBe(SIDEBAR.min);
    useLayout.getState().setSidebar(999);
    expect(useLayout.getState().sidebar).toBe(SIDEBAR.max);
    useLayout.getState().setPreview(10);
    expect(useLayout.getState().preview).toBe(PREVIEW.min);
  });

  it('toggles the collapse and keeps the width to restore', () => {
    useLayout.getState().setSidebar(300);
    useLayout.getState().toggleCollapsed();
    expect(useLayout.getState()).toMatchObject({ collapsed: true, sidebar: 300 });
    useLayout.getState().toggleCollapsed();
    expect(useLayout.getState()).toMatchObject({ collapsed: false, sidebar: 300 });
  });

  it('resets to the defaults', () => {
    useLayout.getState().setSidebar(300);
    useLayout.getState().setCollapsed(true);
    useLayout.getState().resetSidebar();
    expect(useLayout.getState()).toMatchObject({ collapsed: false, sidebar: SIDEBAR.default });
    useLayout.getState().setPreview(600);
    useLayout.getState().resetPreview();
    expect(useLayout.getState().preview).toBe(PREVIEW.default);
  });
});

describe('fitLayout', () => {
  const base = { sidebar: 232, collapsed: false, preview: 380, previewOpen: true };

  it('uses the saved widths when the window is wide enough', () => {
    expect(fitLayout({ ...base, windowWidth: 1600 })).toMatchObject({ sidebar: 232, preview: 380 });
  });

  it('a collapsed sidebar is the icon rail', () => {
    expect(fitLayout({ ...base, collapsed: true, windowWidth: 1600 }).sidebar).toBe(SIDEBAR.rail);
  });

  it('caps the preview at 720 px and 55% of the window', () => {
    expect(fitLayout({ ...base, preview: 720, windowWidth: 2400 }).preview).toBe(720);
    expect(fitLayout({ ...base, preview: 720, windowWidth: 1200 }).previewMax).toBe(1200 - 232 - CHAT_MIN);
    expect(fitLayout({ ...base, preview: 720, windowWidth: 1100 }).preview).toBe(1100 - 232 - CHAT_MIN);
    expect(fitLayout({ ...base, collapsed: true, preview: 720, windowWidth: 1200 }).preview).toBe(Math.floor(1200 * 0.55));
  });

  it('keeps the chat at least 420 px: the preview shrinks to its min first, then the sidebar', () => {
    const tight = fitLayout({ ...base, sidebar: 300, preview: 500, windowWidth: 1000 });
    expect(tight.preview).toBe(PREVIEW.min);
    expect(tight.sidebar).toBe(1000 - PREVIEW.min - CHAT_MIN);
    expect(1000 - tight.sidebar - tight.preview).toBeGreaterThanOrEqual(CHAT_MIN);
    const tighter = fitLayout({ ...base, sidebar: 300, preview: 500, windowWidth: 800 });
    expect(tighter).toMatchObject({ preview: PREVIEW.min, sidebar: SIDEBAR.min });
  });

  it('gives the handles a max that leaves the chat its 420 px', () => {
    const f = fitLayout({ ...base, windowWidth: 1000 });
    expect(f.sidebarMax).toBe(1000 - PREVIEW.min - CHAT_MIN);
    expect(f.previewMax).toBe(1000 - f.sidebar - CHAT_MIN);
    const wide = fitLayout({ ...base, windowWidth: 3000 });
    expect(wide).toMatchObject({ sidebarMax: SIDEBAR.max, previewMax: PREVIEW.max });
  });

  it('without a preview the sidebar only leaves room for the chat', () => {
    const f = fitLayout({ ...base, previewOpen: false, sidebar: 360, windowWidth: 700 });
    expect(f.preview).toBe(0);
    expect(f.sidebar).toBe(700 - CHAT_MIN);
  });

  it('never goes below the mins, even in a tiny window', () => {
    const f = fitLayout({ ...base, windowWidth: 500 });
    expect(f).toMatchObject({ sidebar: SIDEBAR.min, preview: PREVIEW.min, sidebarMax: SIDEBAR.min, previewMax: PREVIEW.min });
  });
});
