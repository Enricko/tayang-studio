import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSessionPreamble } from '../src/preamble';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'agent-plugin');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function frontmatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) throw new Error('no frontmatter');
  return Object.fromEntries(
    m[1]!.split('\n').map((l) => {
      const i = l.indexOf(':');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );
}

describe('agent plugin', () => {
  it('has a valid manifest', () => {
    expect(JSON.parse(read('.claude-plugin/plugin.json'))).toEqual({
      name: 'tayang-studio',
      description: 'Skills for agents running inside Tayang Studio',
      version: '0.1.0',
    });
  });

  it.each(['tayang-studio', 'a2ui-options'])('%s SKILL.md has valid frontmatter', (name) => {
    const fm = frontmatter(read(`skills/${name}/SKILL.md`));
    expect(fm.name).toBe(name);
    expect(fm.description!.length).toBeGreaterThan(20);
  });

  it('tayang-studio description names the env flag', () => {
    const fm = frontmatter(read('skills/tayang-studio/SKILL.md'));
    expect(fm.description).toContain('TAYANG_STUDIO=1');
    expect(read('skills/tayang-studio/SKILL.md')).toContain('Frames checked');
  });

  it('a2ui-options describes v0.9 exactly', () => {
    const t = read('skills/a2ui-options/SKILL.md');
    for (const s of [
      '"version":"v0.9"',
      'createSurface',
      'updateComponents',
      'updateDataModel',
      'deleteSurface',
      'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
      '"id":"root"',
      'ChoicePicker',
      'maxAllowedSelections',
      'sourceComponentId',
    ]) {
      expect(t).toContain(s);
    }
  });

  it('uses pick_topic only for the topic contract', () => {
    for (const name of ['tayang-studio', 'a2ui-options']) {
      const t = read(`skills/${name}/SKILL.md`);
      for (const m of t.matchAll(/"name":"pick_topic"(?:,"context":(\{[^}]*\}))?/g)) {
        // Every pick_topic event in an example carries the topic fields, never another shape.
        expect(m[1], name).toBeDefined();
        expect(Object.keys(JSON.parse(m[1]!.replace(/<[^>]*>/g, '0'))).sort(), name).toEqual(
          ['kind', 'lengthSec', 'styleId', 'title'],
        );
      }
    }
    const a2ui = read('skills/a2ui-options/SKILL.md');
    expect(a2ui).not.toContain('"name":"pick_topic"');
    expect(a2ui).toContain('`pick_topic` is reserved for topic ideas');
    expect(a2ui).toContain('"name":"pick_option"');
  });

  it('preamble contains both skills without frontmatter', () => {
    const p = buildSessionPreamble();
    expect(p).toContain('# Tayang Studio');
    expect(p).toContain('A2UI');
    expect(p).toContain('createSurface');
    expect(p).not.toContain('\nname: a2ui-options');
    expect(p.startsWith('---')).toBe(false);
  });
});
