import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ResizeHandle } from '@/components/ResizeHandle';
import { shouldStartDrag } from '@/lib/windowDrag';

function setup(props: Partial<React.ComponentProps<typeof ResizeHandle>> = {}) {
  const onResize = vi.fn();
  const onReset = vi.fn();
  render(
    <ResizeHandle label="Resize" value={300} min={200} max={360} side="right" onResize={onResize} onReset={onReset} {...props} />,
  );
  return { onResize, onReset, handle: screen.getByRole('separator', { name: 'Resize' }) };
}

describe('ResizeHandle', () => {
  it('is a focusable vertical separator with its value and limits', () => {
    const { handle } = setup();
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('aria-valuenow', '300');
    expect(handle).toHaveAttribute('aria-valuemin', '200');
    expect(handle).toHaveAttribute('aria-valuemax', '360');
    expect(handle).toHaveAttribute('tabindex', '0');
    expect(handle.className).toMatch(/cursor-col-resize/);
    expect(handle.className).toMatch(/w-2/);
  });

  it('moves by 16 px with the arrows, within min and max', async () => {
    const { handle, onResize } = setup();
    handle.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onResize).toHaveBeenLastCalledWith(316);
    await userEvent.keyboard('{ArrowLeft}');
    expect(onResize).toHaveBeenLastCalledWith(284);
  });

  it('stops at max and min', async () => {
    const { handle, onResize } = setup({ value: 352 });
    handle.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onResize).toHaveBeenLastCalledWith(360);
    cleanup();
    const low = setup({ value: 208 });
    low.handle.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(low.onResize).toHaveBeenLastCalledWith(200);
  });

  it('a handle on the left edge grows its panel with ArrowLeft', async () => {
    const { handle, onResize } = setup({ side: 'left' });
    handle.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onResize).toHaveBeenLastCalledWith(316);
  });

  it('Home and End go to min and max', async () => {
    const { handle, onResize } = setup();
    handle.focus();
    await userEvent.keyboard('{Home}');
    expect(onResize).toHaveBeenLastCalledWith(200);
    await userEvent.keyboard('{End}');
    expect(onResize).toHaveBeenLastCalledWith(360);
  });

  it('Enter toggles when it can collapse', async () => {
    const onToggle = vi.fn();
    const { handle } = setup({ onToggle });
    handle.focus();
    await userEvent.keyboard('{Enter}');
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('double-click resets', () => {
    const { handle, onReset } = setup();
    fireEvent.doubleClick(handle);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('drags by the pointer, without selecting text, and reports the raw width', () => {
    const { handle, onResize } = setup();
    handle.setPointerCapture = () => {};
    const down = fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1, button: 0 });
    expect(down).toBe(false); // default prevented: no text selection starts
    expect(document.body.style.userSelect).toBe('none');
    fireEvent.pointerMove(handle, { clientX: 400, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(handle, { clientX: 400, pointerId: 1 });
    expect(onResize).toHaveBeenLastCalledWith(200);
    expect(document.body.style.userSelect).toBe('');
    // raw: below min, so a collapsible panel can snap
    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(handle, { clientX: 300, pointerId: 1 });
    expect(onResize).toHaveBeenLastCalledWith(100);
  });

  it('a left-edge handle grows its panel when dragged left', () => {
    const { handle, onResize } = setup({ side: 'left' });
    handle.setPointerCapture = () => {};
    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 450, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(handle, { clientX: 450, pointerId: 1 });
    expect(onResize).toHaveBeenLastCalledWith(350);
  });

  const start = (handle: HTMLElement) => {
    handle.setPointerCapture = () => {};
    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1, button: 0 });
  };

  it('ends the drag when the window loses focus, and plain moves after it do nothing', () => {
    const { handle, onResize } = setup();
    start(handle);
    fireEvent.pointerMove(handle, { clientX: 520, pointerId: 1, buttons: 1 });
    fireEvent.blur(window);
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');
    expect(onResize).toHaveBeenLastCalledWith(320);
    onResize.mockClear();
    fireEvent.pointerMove(handle, { clientX: 600, pointerId: 1, buttons: 0 });
    fireEvent.pointerMove(handle, { clientX: 650, pointerId: 1, buttons: 1 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it('ends the drag on a move with no button pressed (the button-up was lost)', () => {
    const { handle, onResize } = setup();
    start(handle);
    fireEvent.pointerMove(handle, { clientX: 400, pointerId: 1, buttons: 0 });
    expect(document.body.style.userSelect).toBe('');
    expect(onResize).not.toHaveBeenCalled();
    fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1, buttons: 1 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it('ends the drag on pointercancel and on lost capture', () => {
    for (const lose of [fireEvent.pointerCancel, fireEvent.lostPointerCapture]) {
      const { handle, onResize } = setup();
      start(handle);
      lose(handle, { pointerId: 1 });
      expect(document.body.style.userSelect).toBe('');
      fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1, buttons: 1 });
      expect(onResize).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('unmounting mid-drag gives the page its selection and cursor back', () => {
    const { handle } = setup();
    start(handle);
    expect(document.body.style.cursor).toBe('col-resize');
    cleanup();
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');
  });

  it('reports at most once per animation frame while dragging, then the final width', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
    const { handle, onResize } = setup();
    start(handle);
    fireEvent.pointerMove(handle, { clientX: 510, pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(handle, { clientX: 520, pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(handle, { clientX: 530, pointerId: 1, buttons: 1 });
    expect(frames).toHaveLength(1);
    expect(onResize).not.toHaveBeenCalled();
    frames[0]!(0);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenLastCalledWith(330, true); // live: not saved yet
    fireEvent.pointerUp(handle, { clientX: 530, pointerId: 1 });
    expect(onResize).toHaveBeenLastCalledWith(330); // final: saved
    vi.restoreAllMocks();
  });

  it('collapsible: at min, narrowing keys collapse; collapsed, they do nothing', async () => {
    const onToggle = vi.fn();
    const { handle, onResize } = setup({ value: 200, ariaMin: 64, onToggle });
    handle.focus();
    await userEvent.keyboard('{ArrowLeft}');
    await userEvent.keyboard('{Home}');
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onResize).not.toHaveBeenCalled();
    cleanup();
    const collapsed = setup({ value: 64, ariaMin: 64, onToggle: vi.fn() });
    collapsed.handle.focus();
    await userEvent.keyboard('{ArrowLeft}');
    await userEvent.keyboard('{Home}');
    expect(collapsed.onResize).not.toHaveBeenCalled();
    await userEvent.keyboard('{ArrowRight}');
    expect(collapsed.onResize).toHaveBeenLastCalledWith(200);
  });

  it('never starts a window drag, even at the top edge', () => {
    const { handle } = setup();
    expect(shouldStartDrag(handle, 4)).toBe(false);
  });
});
