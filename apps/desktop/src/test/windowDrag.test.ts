import { describe, expect, it } from 'vitest';
import { shouldStartDrag } from '@/lib/windowDrag';

function dom(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return (sel: string) => root.querySelector(sel)!;
}

describe('shouldStartDrag', () => {
  const $ = () =>
    dom(`
      <header data-tauri-drag-region>
        <h1 id="title">Videos <span id="deep">all</span></h1>
        <button id="btn"><svg id="icon"></svg></button>
        <div role="tab" id="tab">Rendered</div>
        <input id="field" />
        <div data-no-drag><span id="nodrag">x</span></div>
      </header>
      <main><p id="body">text</p><a id="link" href="#">go</a></main>
    `);

  it('drags from any non-interactive child of a drag region', () => {
    const q = $();
    expect(shouldStartDrag(q('#title'), 200)).toBe(true);
    expect(shouldStartDrag(q('#deep'), 200)).toBe(true);
    expect(shouldStartDrag(q('header'), 200)).toBe(true);
  });

  it('drags from the top 32px anywhere', () => {
    const q = $();
    expect(shouldStartDrag(q('#body'), 10)).toBe(true);
    expect(shouldStartDrag(q('#body'), 32)).toBe(true);
    expect(shouldStartDrag(q('#body'), 33)).toBe(false);
  });

  it('never drags from interactive elements', () => {
    const q = $();
    for (const id of ['#btn', '#icon', '#tab', '#field', '#nodrag', '#link']) {
      expect(shouldStartDrag(q(id), 10)).toBe(false);
      expect(shouldStartDrag(q(id), 200)).toBe(false);
    }
  });

  it('ignores non-elements', () => {
    expect(shouldStartDrag(null, 5)).toBe(false);
    expect(shouldStartDrag(window, 5)).toBe(false);
  });
});
