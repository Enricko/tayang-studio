/** A tool title as the command it ran: no "Run" verb, no backticks, single spaces. */
const commandOf = (title: string) =>
  title
    .replace(/^\s*run\s+/i, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const RENDERERS = [
  /\bhyperframes(@[\w.-]+)?\s+render\b/i,
  /\bremotion(@[\w.-]+)?\s+render\b/i,
  /\bnpx\s+(-y\s+)?(@remotion\/cli|remotion)\b/i,
  /\bnpm\s+run\s+render\b/i,
  /\bpnpm\s+(run\s+)?render\b/i,
  // ffmpeg writing an MP4 as its final output
  /\bffmpeg\b.*\s['"]?[^\s'"]+\.mp4['"]?\s*$/i,
];

/**
 * Whether a tool call is a video render: the project's own render command from tayang.json, or one of
 * the usual renderers (HyperFrames, Remotion, an npm/pnpm render script, ffmpeg writing an MP4).
 */
export function isRenderTool(title: string, renderArgv?: string[] | null): boolean {
  const cmd = commandOf(title);
  if (!cmd) return false;
  if (renderArgv?.length) {
    const own = commandOf(renderArgv.join(' '));
    if (own && cmd.includes(own)) return true;
  }
  return RENDERERS.some((re) => re.test(cmd));
}
