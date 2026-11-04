import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSessionPreamble, languageHint, sessionFacts } from '../src/preamble';
import { AUTOPILOT_RENDER_NOW, buildAutopilotBuildPrompt } from '../src/autopilot';
import { FOREGROUND_RULE, RENDERS_RULE } from '../src/frameCheck';
import { buildProjectBrief } from '../src/project';

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
    expect(read('skills/tayang-studio/SKILL.md')).toContain('[tayang:frames-checked]');
    // Settings can turn the check off: the skill must give way to the brief or the message.
    expect(read('skills/tayang-studio/SKILL.md')).toContain(
      'unless the project brief or the message says to skip the frame check',
    );
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
      // A card that is answered stays as it was: a new card needs a new id.
      'Give every new card its own new `surfaceId`',
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

  it('adds the Indonesian hint only for the id language', () => {
    expect(buildSessionPreamble('id')).toContain('The user reads Indonesian. Reply in Indonesian unless they write in another language.');
    expect(buildSessionPreamble('en')).not.toContain('The user reads Indonesian');
    expect(buildSessionPreamble()).not.toContain('The user reads');
    expect(languageHint('id')).toContain('Keep code, commands and file names as they are.');
    expect(languageHint('en')).toBe('');
  });

  it('teaches scheduling with one schedule_videos card, also in the text preamble', () => {
    const t = read('skills/tayang-studio/SKILL.md');
    expect(t).toContain('## Scheduling videos');
    expect(t).toContain('Never say a video is scheduled until the user has confirmed it.');
    expect(t).toContain('Use a new `surfaceId` for every schedule card');
    // The example block is valid A2UI: every line parses, and the button carries well-formed items.
    const block = /```a2ui\n([\s\S]*?)```/.exec(t.slice(t.indexOf('## Scheduling videos')))![1]!;
    const lines = block.trim().split('\n').map((l) => JSON.parse(l.replace('"<id>"', '"p1"')));
    const comps = lines[1].updateComponents.components as { component: string; action?: { event: { name: string; context: { items: { at: string }[] } } } }[];
    const ev = comps.find((c) => c.component === 'Button')!.action!.event;
    expect(ev.name).toBe('schedule_videos');
    for (const item of ev.context.items) expect(item.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
    expect(read('skills/a2ui-options/SKILL.md')).toContain('`schedule_videos` is reserved');
    expect(buildSessionPreamble()).toContain('## Scheduling videos');
  });

  it("states the user's time zone and the project id", () => {
    const facts = { timeZone: 'Asia/Jakarta', offset: '+07:00', localNow: 'Wednesday 2026-11-04 17:55' };
    expect(sessionFacts(facts)).toBe(
      "The user's local time zone is Asia/Jakarta (UTC+07:00). It was Wednesday 2026-11-04 17:55 when this chat started.",
    );
    expect(sessionFacts({ ...facts, projectId: 'p1' })).toContain("\nThis video's Tayang id is p1.");
    expect(sessionFacts(null)).toBe('');
    expect(buildSessionPreamble('en', { ...facts, projectId: 'p1' })).toContain("This video's Tayang id is p1.");
    expect(buildSessionPreamble('en')).not.toContain('time zone is');
  });

  it('tells every agent to run long work in the foreground, wherever it gets its instructions', () => {
    expect(FOREGROUND_RULE).toContain('Never start a long job in the background and end your turn');
    expect(read('skills/tayang-studio/SKILL.md')).toContain(FOREGROUND_RULE);
    expect(buildSessionPreamble()).toContain(FOREGROUND_RULE);
    expect(buildAutopilotBuildPrompt('Jalur Rempah', 30)).toContain(FOREGROUND_RULE);
    expect(AUTOPILOT_RENDER_NOW).toContain(FOREGROUND_RULE);
    const p = { id: 'p', title: 'T', slug: 't', folder: '/w/t', kind: 'explainer', format: '9:16', language: 'id', status: 'draft',
      styleId: null, scheduledAt: null, reviewState: 'none', postedAt: null, remindedAt: null, reviewRemindedAt: null,
      durationSec: null, createdAt: '', updatedAt: '' } as const;
    expect(buildProjectBrief(p, null, { fps: 30, frameCheck: false })).toContain(FOREGROUND_RULE);
  });

  it('tells every agent to leave the final mp4 in renders/, wherever it gets its instructions', () => {
    expect(RENDERS_RULE).toBe(
      "When the video is finished, make sure the final mp4 is in the project's renders/ folder (copy it there if your pipeline writes it elsewhere). Tayang's preview and status read it from there.",
    );
    expect(read('skills/tayang-studio/SKILL.md')).toContain(RENDERS_RULE);
    expect(buildSessionPreamble()).toContain(RENDERS_RULE);
    expect(buildAutopilotBuildPrompt('Jalur Rempah', 30)).toContain(RENDERS_RULE);
    expect(AUTOPILOT_RENDER_NOW).toContain(RENDERS_RULE);
    const p = { id: 'p', title: 'T', slug: 't', folder: '/w/t', kind: 'explainer', format: '9:16', language: 'id', status: 'draft',
      styleId: null, scheduledAt: null, reviewState: 'none', postedAt: null, remindedAt: null, reviewRemindedAt: null,
      durationSec: null, createdAt: '', updatedAt: '' } as const;
    // With and without a template (a template's pipeline may write elsewhere).
    expect(buildProjectBrief(p, null, { fps: 30, frameCheck: false })).toContain(RENDERS_RULE);
    const tmpl = { id: 's', name: 'Atlas', notes: {}, template: { url: 'x' } } as never;
    expect(buildProjectBrief(p, tmpl, { fps: 30, frameCheck: true })).toContain(RENDERS_RULE);
  });
});
