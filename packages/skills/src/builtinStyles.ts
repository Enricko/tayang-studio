import type { Style } from '@tayang/shared';

const createdAt = '2026-11-04T00:00:00Z';

export const BUILTIN_STYLES: Style[] = [
  {
    id: 'builtin-bold-explainer',
    name: 'Bold explainer',
    source: 'builtin',
    sourceUrl: null,
    notes: {
      camera: 'Static frame, elements slide in from the bottom',
      pacing: 'New scene every 4–8s, words land on the voice',
      type: 'Heavy sans, one highlighted word per line',
      color: 'Navy, white, one yellow highlight',
      captions: 'Word by word, center low',
    },
    prompt:
      'Navy background, white heavy sans.\nHighlight one key word per line in yellow.\nAnimate elements up 24px with ease-out, 300ms.\nCaptions word by word, centered low.',
    createdAt,
  },
  {
    id: 'builtin-kinetic-quote',
    name: 'Kinetic quote',
    source: 'builtin',
    sourceUrl: null,
    notes: {
      camera: 'Slow push in, 100% to 106% over the clip',
      pacing: 'One word every 0.3s, hold 1s at the end',
      type: 'Huge sans, stacked words',
      color: 'Orange ground, ink text',
      captions: 'The words are the captions',
    },
    prompt:
      'One short line, stacked one word per row.\nEach word pops in at 0.3s intervals.\nSlow push in from 100% to 106%.\nHold the full line for 1s.',
    createdAt,
  },
  {
    id: 'builtin-news-recap',
    name: 'News recap',
    source: 'builtin',
    sourceUrl: null,
    notes: {
      camera: 'Static, lower third slides in',
      pacing: 'One story per 8s',
      type: 'Medium sans, numbered stories',
      color: 'Light paper, navy text, red tag',
      captions: 'Full line, bottom',
    },
    prompt:
      'Light background, navy text.\nNumber each story 1–3 with a small red tag.\nLower third slides in from the left, 250ms.\nOne story per 8 seconds.',
    createdAt,
  },
];
