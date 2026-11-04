export const FRAME_CHECK_PROMPT = [
  'Check the frames before you report this video as done.',
  '1. Render a still of every scene with `npx hyperframes`.',
  '2. Look at each still for overlapping elements, text that is cut off or outside the safe area, and timing that does not match the voice or captions.',
  '3. Fix every problem you find, then render and look at the affected stills again.',
  '4. When all stills are clean, reply with "Frames checked" and a one-line summary of what you fixed.',
].join('\n');
