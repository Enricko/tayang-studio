import tayangStudio from '../agent-plugin/skills/tayang-studio/SKILL.md?raw';
import a2uiOptions from '../agent-plugin/skills/a2ui-options/SKILL.md?raw';

const stripFrontmatter = (text: string): string => text.replace(/^---\n[\s\S]*?\n---\n+/, '').trim();

/**
 * The Tayang skills as plain text, for agents that cannot load the Claude Code
 * plugin. Put it in front of the first prompt of a session.
 */
export function buildSessionPreamble(): string {
  return [
    'You are running inside Tayang Studio. Follow these instructions for the whole session.',
    stripFrontmatter(tayangStudio),
    stripFrontmatter(a2uiOptions),
    '---',
  ].join('\n\n');
}
