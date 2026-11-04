import { slugify, type Project, type Settings, type Style, type VideoLanguage } from '@tayang/shared';
import { FRAME_CHECK_PROMPT } from './frameCheck';

const LANGUAGE: Record<VideoLanguage, string> = { id: 'Indonesian', en: 'English' };

/** Sent before a project chat's prompt when the frame check is turned off in Settings. */
export const SKIP_FRAME_CHECK = 'Skip the frame check this time.';

/** The project's AGENTS.md. The quality loop is only included when `settings.frameCheck` is on. */
export function buildProjectBrief(
  p: Project,
  style: Style | null,
  settings: Pick<Settings, 'fps' | 'frameCheck'>,
): string {
  const template = !!style?.template;
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
    ...(template
      ? ['- When a version is ready, render it with the command in tayang.json so Tayang can show it.']
      : [
          `- When a version is ready, render it with \`npx -y hyperframes@0.9.10 render --output renders/${p.slug || slugify(p.title)}-<n>.mp4\` so Tayang can show it.`,
        ]),
    '',
    '## Style',
    style ? `Style: ${style.name}\n${style.prompt}` : 'No style selected. Choose a clean, readable look and keep it consistent.',
    ...(style?.template
      ? [
          '',
          `This project starts from the ${style.name} template. Read STYLE.md first, then run the install command in tayang.json once. Render with the command in tayang.json.`,
        ]
      : []),
    '',
    ...(settings.frameCheck ? ['## Quality loop', FRAME_CHECK_PROMPT, ''] : []),
  ];
  return lines.join('\n');
}
