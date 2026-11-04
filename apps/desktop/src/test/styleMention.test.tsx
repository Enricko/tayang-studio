import { describe, expect, it } from 'vitest';
import type { Style } from '@tayang/shared';
import { styleContext } from '@/lib/mentions';

const atlas: Style = {
  id: 'builtin-atlas',
  name: 'Atlas journey',
  source: 'builtin',
  sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
  notes: { camera: 'Slow push-ins on the map', pacing: '', color: 'Navy and paper white' },
  prompt: 'Animate a journey across a paper map.',
  createdAt: '',
  previewUrl: 'https://cdn.tayang.app/atlas.jpg',
  previewVideoUrl: 'https://cdn.tayang.app/atlas.mp4',
  template: { sha256: 'a', size: 1, version: 1 },
};

describe('styleContext', () => {
  it('sends the prompt and the non-empty notes, the template line, and no URLs', () => {
    const out = styleContext([{ type: 'style-mention', styleId: 'builtin-atlas', name: 'Atlas journey' }], [atlas]);
    expect(out).toHaveLength(1);
    const text = out[0]!.type === 'text' ? out[0]!.text : '';
    expect(text).toBe(
      [
        'Use the style "Atlas journey" for this video:',
        'Animate a journey across a paper map.',
        'Camera: Slow push-ins on the map',
        'Color: Navy and paper white',
        'This style has a starter template; Tayang sets it up when a new video starts from it.',
      ].join('\n'),
    );
    expect(text).not.toMatch(/https?:/);
  });

  it('leaves out the template line for a style without one, and skips styles it does not know', () => {
    const mine: Style = { ...atlas, id: 'mine', name: 'Mine', source: 'mine', template: null, notes: {} };
    const out = styleContext(
      [
        { type: 'style-mention', styleId: 'mine', name: 'Mine' },
        { type: 'style-mention', styleId: 'gone', name: 'Gone' },
        { type: 'text', text: 'halo' },
      ],
      [mine],
    );
    expect(out).toEqual([{ type: 'text', text: 'Use the style "Mine" for this video:\nAnimate a journey across a paper map.' }]);
  });
});
