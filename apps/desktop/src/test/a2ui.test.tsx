import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));
import { openUrl } from '@tauri-apps/plugin-opener';
import { extractA2ui } from '@/a2ui/parse';
import { applyMessages, emptySurfaces, type Surface } from '@/a2ui/surface';
import { getAt, setAt } from '@/a2ui/pointer';
import { A2uiSurface, type A2uiAction } from '@/a2ui/render';

const V = 'v0.9';
const surfaceOf = (messages: unknown[], id = 's1'): Surface => applyMessages(emptySurfaces(), messages).surfaces[id]!;
const create = { version: V, createSurface: { surfaceId: 's1', catalogId: 'basic' } };
const comps = (components: unknown[]) => ({ version: V, updateComponents: { surfaceId: 's1', components } });
const data = (path: string, value?: unknown) => ({
  version: V,
  updateDataModel: { surfaceId: 's1', path, ...(value === undefined ? {} : { value }) },
});

describe('extractA2ui', () => {
  it('pulls a block out of mixed text', () => {
    const text = `Pick one:\n\n\`\`\`a2ui\n${JSON.stringify(create)}\n${JSON.stringify(comps([]))}\n\`\`\`\n\nThen tell me.`;
    const r = extractA2ui(text);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]).toHaveLength(2);
    expect(r.text).toBe('Pick one:\n\nThen tell me.');
    expect(r.pending).toBe(false);
  });

  it('accepts a JSON array', () => {
    const r = extractA2ui(`\`\`\`a2ui\n${JSON.stringify([create])}\n\`\`\``);
    expect(r.blocks).toEqual([[create]]);
  });

  it('keeps invalid JSON as plain text', () => {
    const text = 'Hi\n```a2ui\n{nope\n```';
    const r = extractA2ui(text);
    expect(r.blocks).toEqual([]);
    expect(r.text).toBe(text);
  });

  it('marks an unclosed fence as pending and hides it', () => {
    const r = extractA2ui('Options:\n```a2ui\n{"version":"v0.9","crea');
    expect(r.pending).toBe(true);
    expect(r.text).toBe('Options:');
  });
});

describe('surface store', () => {
  it('applies create, update components, data model and delete', () => {
    let set = applyMessages(emptySurfaces(), [
      create,
      comps([{ id: 'root', component: 'Text', text: 'Hi' }]),
      comps([{ id: 'root', component: 'Text', variant: 'h1' }, { id: 'b', component: 'Divider' }]),
      data('/user/name', 'Dewi'),
      data('/list', [1, 2]),
    ]);
    const s = set.surfaces.s1!;
    expect(s.components.root).toEqual({ id: 'root', component: 'Text', text: 'Hi', variant: 'h1' });
    expect(Object.keys(s.components)).toEqual(['root', 'b']);
    expect(s.data).toEqual({ user: { name: 'Dewi' }, list: [1, 2] });
    set = applyMessages(set, [data('/user/name'), { version: V, deleteSurface: { surfaceId: 's1' } }]);
    expect(set.surfaces.s1).toBeUndefined();
  });

  it('deletes a value when none is given', () => {
    const s = surfaceOf([create, data('/a', { b: 1, c: 2 }), data('/a/b')]);
    expect(s.data).toEqual({ a: { c: 2 } });
  });

  it('ignores other versions with a note', () => {
    const set = applyMessages(emptySurfaces(), [{ version: 'v0.8', createSurface: { surfaceId: 's1' } }]);
    expect(set.surfaces).toEqual({});
    expect(set.notes).toHaveLength(1);
  });

  it('json pointer escapes and prototype safety', () => {
    expect(getAt({ 'a/b': { '~x': 1 } }, '/a~1b/~0x')).toBe(1);
    const out = setAt({}, '/__proto__/polluted', true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(out).toEqual({});
  });
});

const card = [
  create,
  comps([
    { id: 'root', component: 'Card', child: 'col' },
    { id: 'col', component: 'Column', children: ['title', 'a', 'b'] },
    { id: 'title', component: 'Text', variant: 'h3', text: 'Pick a topic' },
    { id: 'a-t', component: 'Text', text: 'Kenapa rupiah melemah?' },
    { id: 'b-t', component: 'Text', text: 'Bunga KPR naik' },
    {
      id: 'a',
      component: 'Button',
      child: 'a-t',
      variant: 'primary',
      action: { event: { name: 'pick_topic', context: { topic: 'rupiah', title: { path: '/chosen' } } } },
    },
    { id: 'b', component: 'Button', child: 'b-t', action: { event: { name: 'pick_topic', context: { topic: 'kpr' } } } },
  ]),
  data('/chosen', 'x'),
];

describe('A2uiSurface', () => {
  it('renders a card with text and two buttons', () => {
    render(<A2uiSurface surface={surfaceOf(card)} onAction={vi.fn()} />);
    expect(screen.getByText('Pick a topic')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kenapa rupiah melemah?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bunga KPR naik' })).toBeInTheDocument();
  });

  it('resolves context paths and reports the action', async () => {
    const onAction = vi.fn<(a: A2uiAction) => void>();
    render(<A2uiSurface surface={surfaceOf(card)} onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Kenapa rupiah melemah?' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    const a = onAction.mock.calls[0]![0];
    expect(a).toMatchObject({
      name: 'pick_topic',
      surfaceId: 's1',
      sourceComponentId: 'a',
      context: { topic: 'rupiah', title: 'x' },
    });
    expect(a.summary).toBe('Picked: Kenapa rupiah melemah?');
    expect(Number.isNaN(Date.parse(a.timestamp))).toBe(false);
  });

  it('disables inputs when answered', () => {
    render(<A2uiSurface surface={surfaceOf(card)} onAction={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: 'Bunga KPR naik' })).toBeDisabled();
  });

  it('single ChoicePicker binds one selection and is used in the summary', async () => {
    const onAction = vi.fn<(a: A2uiAction) => void>();
    const s = surfaceOf([
      create,
      comps([
        { id: 'root', component: 'Column', children: ['pick', 'go'] },
        {
          id: 'pick',
          component: 'ChoicePicker',
          maxAllowedSelections: 1,
          options: [
            { label: 'Short', value: 'short' },
            { label: 'Long', value: 'long' },
          ],
          selections: { path: '/len' },
        },
        { id: 'go-t', component: 'Text', text: 'Send' },
        {
          id: 'go',
          component: 'Button',
          child: 'go-t',
          action: { event: { name: 'length', context: { len: { path: '/len' } } } },
        },
      ]),
      data('/len', ['short']),
    ]);
    render(<A2uiSurface surface={s} onAction={onAction} />);
    expect(screen.getByRole('radio', { name: 'Short' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Long' }));
    expect(screen.getByRole('radio', { name: 'Long' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onAction.mock.calls[0]![0].context).toEqual({ len: ['long'] });
    expect(onAction.mock.calls[0]![0].summary).toBe('Picked: Long');
  });

  it('multi ChoicePicker toggles chips', async () => {
    const onAction = vi.fn<(a: A2uiAction) => void>();
    const s = surfaceOf([
      create,
      comps([
        { id: 'root', component: 'Column', children: ['pick', 'go'] },
        {
          id: 'pick',
          component: 'ChoicePicker',
          options: [
            { label: 'Hook', value: 'hook' },
            { label: 'Captions', value: 'cap' },
            { label: 'Music', value: 'mus' },
          ],
          selections: { path: '/sel' },
        },
        { id: 'go-t', component: 'Text', text: 'Done' },
        { id: 'go', component: 'Button', child: 'go-t', action: { event: { name: 'sel', context: { sel: { path: '/sel' } } } } },
      ]),
      data('/sel', []),
    ]);
    render(<A2uiSurface surface={s} onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hook' }));
    await userEvent.click(screen.getByRole('button', { name: 'Music' }));
    expect(screen.getByRole('button', { name: 'Hook' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Hook' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onAction.mock.calls[0]![0].context).toEqual({ sel: ['mus'] });
  });

  it('TextField binds to the data model', async () => {
    const onAction = vi.fn<(a: A2uiAction) => void>();
    const s = surfaceOf([
      create,
      comps([
        { id: 'root', component: 'Column', children: ['tf', 'go'] },
        { id: 'tf', component: 'TextField', label: 'Angle', value: { path: '/angle' } },
        { id: 'go-t', component: 'Text', text: 'Save' },
        { id: 'go', component: 'Button', child: 'go-t', action: { event: { name: 'save', context: { angle: { path: '/angle' } } } } },
      ]),
    ]);
    render(<A2uiSurface surface={s} onAction={onAction} />);
    await userEvent.type(screen.getByLabelText('Angle'), 'hot take');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onAction.mock.calls[0]![0].context).toEqual({ angle: 'hot take' });
  });

  it('repeats a template over a list', () => {
    const s = surfaceOf([
      create,
      comps([
        { id: 'root', component: 'List', children: { componentId: 'row', path: '/items' } },
        { id: 'row', component: 'Text', text: { path: 'title' } },
      ]),
      data('/items', [{ title: 'One' }, { title: 'Two' }]),
    ]);
    render(<A2uiSurface surface={s} onAction={vi.fn()} />);
    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
  });

  it('shows a muted note for unsupported components', () => {
    const s = surfaceOf([
      create,
      comps([
        { id: 'root', component: 'Column', children: ['d', 'x'] },
        { id: 'd', component: 'DateTimeInput', value: { path: '/d' } },
        { id: 'x', component: 'Hologram' },
      ]),
    ]);
    render(<A2uiSurface surface={s} onAction={vi.fn()} />);
    expect(screen.getAllByText("This option can't be shown here")).toHaveLength(2);
  });

  it('only shows https or asset images', () => {
    const s = surfaceOf([
      create,
      comps([
        { id: 'root', component: 'Column', children: ['a', 'b'] },
        { id: 'a', component: 'Image', url: 'https://example.com/a.png' },
        { id: 'b', component: 'Image', url: 'javascript:alert(1)' },
      ]),
    ]);
    const { container } = render(<A2uiSurface surface={s} onAction={vi.fn()} />);
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.getAttribute('src')).toBe('https://example.com/a.png');
  });

  it('openUrl needs a confirm and https', async () => {
    const mk = (url: string) =>
      surfaceOf([
        create,
        comps([
          { id: 'root', component: 'Button', child: 't', action: { functionCall: { call: 'openUrl', args: { url } } } },
          { id: 't', component: 'Text', text: 'Read more' },
        ]),
      ]);
    const onAction = vi.fn();
    const { unmount } = render(<A2uiSurface surface={mk('https://example.com')} onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Read more' }));
    expect(openUrl).not.toHaveBeenCalled();
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByText('https://example.com')).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Open link' }));
    expect(openUrl).toHaveBeenCalledWith('https://example.com');
    expect(onAction).not.toHaveBeenCalled();
    unmount();

    vi.mocked(openUrl).mockClear();
    render(<A2uiSurface surface={mk('http://example.com')} onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Read more' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(openUrl).not.toHaveBeenCalled();
  });
});
