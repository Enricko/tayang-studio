import type { Project, Settings, Style, VideoLanguage } from '@tayang/shared';
import { FRAME_CHECK_PROMPT } from './frameCheck';

const LANGUAGE: Record<VideoLanguage, string> = { id: 'Indonesian', en: 'English' };

export function buildProjectBrief(p: Project, style: Style | null, settings: Settings): string {
  const lines = [
    `# ${p.title}`,
    '',
    '## Project',
    `- Kind: ${p.kind}`,
    `- Format: ${p.format}, ${settings.fps} fps`,
    `- Video language: ${LANGUAGE[p.language]}. All on-screen text and voice-over are in ${LANGUAGE[p.language]}.`,
    '',
    '## How to work',
    '- Use HyperFrames (`npx hyperframes`) to build and render the video.',
    '- Keep all files in this folder. Do not write outside it.',
    '',
    '## Style',
    style ? `Style: ${style.name}\n${style.prompt}` : 'No style selected. Choose a clean, readable look and keep it consistent.',
    '',
    '## Quality loop',
    FRAME_CHECK_PROMPT,
    '',
  ];
  return lines.join('\n');
}
