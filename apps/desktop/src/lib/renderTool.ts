/** A tool title as the command it ran: no "Run" verb, no backticks, single spaces. */
const commandOf = (title: string) =>
  title
    .replace(/^\s*run\s+/i, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The commands a shell line runs, split at `&&`, `||`, `;` and `|`, without output redirections
 * (`2>&1`, `> log.txt`) or a trailing `&`.
 */
const commandsOf = (cmd: string) =>
  cmd
    .split(/\s*(?:&&|\|\||;|\|)\s*/)
    .map((c) =>
      c
        .replace(/\s*\d*>>?\s*(?:&\d+|\S+)/g, '')
        .replace(/\s+&$/, '')
        .trim(),
    )
    .filter(Boolean);

const RENDERERS = [
  /\bhyperframes(@[\w.-]+)?\s+render\b/i,
  /\bremotion(@[\w.-]+)?\s+render\b/i,
  /\bnpx\s+(-y\s+)?(@remotion\/cli|remotion)\b/i,
  /\bnpm\s+run\s+render\b/i,
  /\bpnpm\s+(run\s+)?render\b/i,
];

/** Asking a renderer for its help or version renders nothing. */
const ASKS_ONLY = /\s--(help|version)\b/i;

/** ffmpeg writing an MP4 as its output: the last argument that is not a flag. */
function ffmpegToMp4(cmd: string): boolean {
  if (!/(^|\s)(\S*\/)?ffmpeg(\s|$)/i.test(cmd)) return false;
  const args = cmd.split(' ');
  while (args.length && args.at(-1)!.startsWith('-')) args.pop();
  return /\.mp4['"]?$/i.test(args.at(-1) ?? '');
}

/**
 * Whether a tool call is a video render: the project's own render command from tayang.json, or one of
 * the usual renderers (HyperFrames, Remotion, an npm/pnpm render script, ffmpeg writing an MP4), also
 * inside a chain (`cd p && …`) or a pipe (`… 2>&1 | tail`).
 */
export function isRenderTool(title: string, renderArgv?: string[] | null): boolean {
  const own = renderArgv?.length ? commandOf(renderArgv.join(' ')) : '';
  return commandsOf(commandOf(title)).some((cmd) => {
    // Whole words only: `make` is not `cmake`.
    if (own && ` ${cmd} `.includes(` ${own} `)) return true;
    if (ASKS_ONLY.test(cmd)) return false;
    return ffmpegToMp4(cmd) || RENDERERS.some((re) => re.test(cmd));
  });
}
