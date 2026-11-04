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

export const FRAME_CHECK_PROMPT = [
  'Check the frames before you report this video as done.',
  '1. Render a still of every scene with `npx hyperframes`.',
  '2. Look at each still for overlapping elements, text that is cut off or outside the safe area, and timing that does not match the voice or captions.',
  '3. Fix every problem you find, then render and look at the affected stills again.',
  `4. When all stills are clean, write ${FRAMES_CHECKED_TOKEN} exactly as shown, whatever language you reply in, then a one-line summary of what you fixed.`,
].join('\n');
