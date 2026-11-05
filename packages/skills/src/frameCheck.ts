/**
 * What the agent writes, word for word in any language, once every still is clean. Tayang looks for it to
 * show the "frames checked" badge and hides it from the message.
 */
export const FRAMES_CHECKED_TOKEN = '[tayang:frames-checked]';

/** The old English phrase, still accepted for chats written before the token existed. */
const LEGACY_PHRASE = 'Frames checked';

export const hasFramesChecked = (text: string): boolean => text.includes(FRAMES_CHECKED_TOKEN) || text.includes(LEGACY_PHRASE);

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WRAPPED_TOKEN = new RegExp(`\`*${escapeRe(FRAMES_CHECKED_TOKEN)}\`*`, 'g');
/** Every proper prefix of the token, longest first, so a half-streamed one can be hidden. */
const PARTIAL_TOKEN = new RegExp(
  `\`*(?:${Array.from({ length: FRAMES_CHECKED_TOKEN.length - 1 }, (_, i) => escapeRe(FRAMES_CHECKED_TOKEN.slice(0, FRAMES_CHECKED_TOKEN.length - 1 - i))).join('|')})$`,
);

/**
 * The message as the reader sees it: the token is plumbing, also when the agent wraps it in
 * backticks, and also while it is still being typed at the end of streaming text.
 */
export const stripFramesToken = (text: string): string => {
  const whole = text.replace(WRAPPED_TOKEN, '');
  const cut = whole.replace(PARTIAL_TOKEN, '');
  if (cut === text) return text;
  return cut.replace(/(\S) {2,}/g, '$1 ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
};

/** Agents can't speak after their turn ends: long work must run inside the turn, where Tayang shows it. */
export const FOREGROUND_RULE =
  "Run installs, renders and pipelines in the foreground and wait for them to finish before you reply. Never start a long job in the background and end your turn: you can't message the user after your turn ends, and Tayang shows the user that you're still working while your turn runs. If a command needs more than a few minutes, say so first, then run it and wait.";

/** Tayang's preview and status read the render from renders/; a template pipeline may write it elsewhere. */
export const RENDERS_RULE =
  "When the video is finished, make sure the final mp4 is in the project's renders/ folder (copy it there if your pipeline writes it elsewhere). Tayang's preview and status read it from there.";

/** Folder in a project where Tayang puts the style's reference frames. */
export const STYLE_REFS_DIR = 'style-refs';

/** The quality loop for the project's engine; with references, every still is held against them too. */
export function frameCheckPrompt(opts: { engine?: 'hyperframes' | 'remotion'; references?: boolean } = {}): string {
  const still =
    opts.engine === 'remotion'
      ? '1. Render a still of every scene with `npx remotion still` (one frame per scene).'
      : '1. Render a still of every scene with `npx hyperframes`.';
  return [
    'Check the frames before you report this video as done.',
    still,
    '2. Look at each still for overlapping elements, text that is cut off or outside the safe area, and timing that does not match the voice or captions.',
    ...(opts.references
      ? [
          `   Then make a contact sheet of your render the same way as the references (\`ffmpeg -i <your render> -vf "fps=12/<duration>,scale=320:-2,tile=4x3" -frames:v 1 renders/check-sheet.jpg\`) and look at it side by side with the contact sheets in ${STYLE_REFS_DIR}/: the same rendering technique, character design, palette, lighting, camera framing, caption style and pacing. Anything that looks different is a problem to fix.`,
        ]
      : []),
    '3. Fix every problem you find, then render and look at the affected stills again.',
    `4. When all stills are clean, write ${FRAMES_CHECKED_TOKEN} exactly as shown, whatever language you reply in, then a one-line summary of what you fixed.`,
  ].join('\n');
}

/** The default (HyperFrames, no references) quality loop. */
export const FRAME_CHECK_PROMPT = frameCheckPrompt();

