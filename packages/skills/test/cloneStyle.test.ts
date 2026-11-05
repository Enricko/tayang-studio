import { describe, expect, it } from 'vitest';
import type { Project, Style } from '@tayang/shared';
import { buildProjectBrief, buildStudyStylePrompt, frameCheckPrompt, parseStyleResult, STYLE_REFS_DIR } from '../src';

const project = { title: 'Krakatoa', slug: 'krakatoa', kind: 'explainer', format: '9:16', language: 'en' } as Project;

const copied3d: Style = {
  id: 'copied-1',
  name: 'Storybook 3D',
  source: 'copied',
  sourceUrl: 'https://youtu.be/x',
  notes: { camera: 'Slow dolly-ins' },
  prompt: 'A storybook 3D cartoon.',
  createdAt: '',
  engine: 'remotion',
  build: 'Three.js world inside Remotion (@remotion/three); flat 2D characters on billboards; toon shading.',
  palette: ['#5BC8F5', '#F2C14E', '#2E7D32'],
  references: ['/data/style-refs/copied-1/sheet-01.jpg', '/data/style-refs/copied-1/sheet-02.jpg'],
};

describe('study prompt for a complete clone', () => {
  const p = buildStudyStylePrompt('https://v', '/out');
  it('asks for the engine, a build recipe and a palette', () => {
    expect(p).toContain('"engine"');
    expect(p).toContain('"build"');
    expect(p).toContain('"palette"');
    expect(p).toMatch(/remotion/i);
    expect(p).toMatch(/hyperframes/i);
  });
  it('has the agent study contact sheets of the whole video, many frames per image', () => {
    expect(p).toContain('tile=4x3');
    expect(p).toContain('fps=48/<duration>');
    expect(p).toContain('`"/out/sheets"`');
    expect(p).not.toContain('ref-1.jpg');
  });
  it('no longer tells the agent to recreate every look with HyperFrames', () => {
    expect(p).not.toContain('recreate the look with HyperFrames');
  });
});

describe('parseStyleResult keeps the recipe', () => {
  it('reads engine, build and a cleaned palette', () => {
    const json = JSON.stringify({
      name: 'S',
      notes: { camera: 'c' },
      prompt: 'p',
      engine: 'remotion',
      build: '  three.js in Remotion  ',
      palette: ['#5bc8f5', 'red', '#F2C14E', 12, '#abc'],
    });
    expect(parseStyleResult(json, 'u')).toMatchObject({
      engine: 'remotion',
      build: 'three.js in Remotion',
      palette: ['#5BC8F5', '#F2C14E', '#AABBCC'],
    });
  });
  it('drops an unknown engine and missing fields', () => {
    const out = parseStyleResult(JSON.stringify({ name: 'S', notes: {}, prompt: 'p', engine: 'blender' }), 'u')!;
    expect(out.engine).toBeUndefined();
    expect(out.build ?? null).toBeNull();
    expect(out.palette ?? []).toEqual([]);
  });
});

describe('brief for a copied style', () => {
  it('uses the style engine instead of forcing HyperFrames, with the recipe, palette and references', () => {
    const b = buildProjectBrief(project, copied3d, { fps: 30, frameCheck: true });
    expect(b).not.toContain('Use HyperFrames');
    expect(b).toContain('Build it with Remotion');
    expect(b).toContain('npx remotion render');
    expect(b).toContain('renders/krakatoa-<n>.mp4');
    expect(b).toContain('How to build this look: Three.js world inside Remotion');
    expect(b).toContain('Palette: #5BC8F5, #F2C14E, #2E7D32');
    expect(b).toContain(`${STYLE_REFS_DIR}/sheet-01.jpg`);
    expect(b).toContain(`${STYLE_REFS_DIR}/sheet-02.jpg`);
    expect(b).toContain('a 4x3 grid of frames from the source video in time order');
    expect(b).toMatch(/never copy/i);
    expect(b).toContain('npx remotion still');
    expect(b).toContain(`side by side with the contact sheets in ${STYLE_REFS_DIR}/`);
    expect(b).toContain('tile=4x3');
  });
  it('a HyperFrames style without references keeps the HyperFrames toolchain and no reference step', () => {
    const flat: Style = { ...copied3d, engine: 'hyperframes', build: null, palette: [], references: [] };
    const b = buildProjectBrief(project, flat, { fps: 30, frameCheck: true });
    expect(b).toContain('Use HyperFrames');
    expect(b).not.toContain(STYLE_REFS_DIR);
    expect(b).toContain('npx hyperframes');
  });
  it('frameCheckPrompt defaults to the old HyperFrames wording', () => {
    expect(frameCheckPrompt()).toContain('npx hyperframes');
    expect(frameCheckPrompt({ engine: 'remotion', references: true })).toContain('npx remotion still');
  });
});
