import type { UiLanguage } from '@tayang/shared';
import tayangStudio from '../agent-plugin/skills/tayang-studio/SKILL.md?raw';
import a2uiOptions from '../agent-plugin/skills/a2ui-options/SKILL.md?raw';

const stripFrontmatter = (text: string): string => text.replace(/^---\n[\s\S]*?\n---\n+/, '').trim();

/** One line telling the agent which language the user reads; empty for English, the default. */
export function languageHint(language?: UiLanguage | null): string {
  return language === 'id'
    ? 'The user reads Indonesian. Reply in Indonesian unless they write in another language. Keep code, commands and file names as they are.'
    : '';
}

/**
 * The Tayang skills as plain text, for agents that cannot load the Claude Code
 * plugin. Put it in front of the first prompt of a session.
 */
export function buildSessionPreamble(language?: UiLanguage | null): string {
  return [
    'You are running inside Tayang Studio. Follow these instructions for the whole session.',
    stripFrontmatter(tayangStudio),
    stripFrontmatter(a2uiOptions),
    languageHint(language),
    '---',
  ]
    .filter(Boolean)
    .join('\n\n');
}
