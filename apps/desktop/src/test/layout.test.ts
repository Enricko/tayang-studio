import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_MIN, PREVIEW, SIDEBAR, fitLayout, layoutKey, loadLayout, useLayout } from '@/state/layout';

const KEY = layoutKey();

describe('layout persistence', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('starts from the defaults when nothing is saved', () => {
    expect(loadLayout()).toEqual({ sidebar: SIDEBAR.default, collapsed: false, preview: PREVIEW.default });
  });

  it('reads saved widths, clamped to their limits', () => {
    localStorage.setItem(KEY, JSON.stringify({ sidebar: 300, collapsed: true, preview: 9999 }));
    expect(loadLayout()).toEqual({ sidebar: 300, collapsed: true, preview: PREVIEW.max });
  });

  it('ignores junk', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadLayout()).toEqual({ sidebar: SIDEBAR.default, collapsed: false, preview: PREVIEW.default });
    localStorage.setItem(KEY, JSON.stringify({ sidebar: 'wide', collapsed: 1 }));
    expect(loadLayout()).toEqual({ sidebar: SIDEBAR.default, collapsed: false, preview: PREVIEW.default });
  });

  it('writes every change', () => {
    useLayout.getState().hydrate();
    useLayout.getState().setSidebar(280);
    useLayout.getState().setPreview(500);
    useLayout.getState().setCollapsed(true);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ sidebar: 280, collapsed: true, preview: 500 });
  });

  it('works when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadLayout()).toEqual({ sidebar: SIDEBAR.default, collapsed: false, preview: PREVIEW.default });
    useLayout.getState().hydrate();
    expect(() => useLayout.getState().setSidebar(300)).not.toThrow();
    expect(useLayout.getState().sidebar).toBe(300);
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
    expect(f.sidebarMax).toBe(1000 - f.preview - CHAT_MIN);
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
