import { jsonrepair } from 'jsonrepair';

/** Pulls ```a2ui fenced blocks out of agent text. */
export interface Extracted {
  /** The text with every a2ui block removed (a closed but broken block too: never show raw JSON). */
  text: string;
  /** Each valid block as a list of v0.9 messages. */
  blocks: unknown[][];
  /** True when the text ends inside an a2ui fence that has not closed yet. */
  pending: boolean;
  /** Closed blocks that were not valid JSON. */
  invalid: number;
}

const KINDS = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'] as const;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * An A2UI message: a version and one of the message kinds as an object. Anything else in a block
 * means the block is not A2UI, also after a repair (which turns a cut-off `"createSurface":` into null).
 */
const isMessage = (v: unknown) => isObject(v) && typeof v.version === 'string' && KINDS.some((k) => isObject(v[k]));

const asMessages = (v: unknown): unknown[] | null => {
  const list = Array.isArray(v) ? v : [v];
  return list.length && list.every(isMessage) ? list : null;
};

/**
 * Escapes a quote written inside a string ("Gaya "Cartoon 3D" ok"): inside a string, a quote closes
 * it only when what follows is `,` `}` `]` `:`, a line break or the end; any other quote is text.
 */
export function escapeInnerQuotes(src: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (!inString) {
      if (c === '"') inString = true;
      out += c;
      continue;
    }
    if (c === '\\') {
      out += c + (src[i + 1] ?? '');
      i++;
      continue;
    }
    if (c === '"') {
      const next = /^[ \t]*([\s\S]?)/.exec(src.slice(i + 1))![1];
      if (next === '' || ',}]:\n\r'.includes(next!)) {
        inString = false;
        out += c;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += c;
  }
  return out;
}

/** JSON.parse, then with inner quotes escaped, then jsonrepair (trailing commas, line breaks in strings…). */
function parseLoose(src: string): unknown {
  const attempts = [() => src, () => escapeInnerQuotes(src), () => jsonrepair(escapeInnerQuotes(src)), () => jsonrepair(src)];
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt());
    } catch {
      /* next */
    }
  }
  return undefined;
}

/**
 * The block's top-level values, one after another: one per line (the asked-for form), pretty-printed
 * over several lines, or both. Splits where an object or array closes at depth 0 outside a string,
 * or at a line break at depth 0. A quote left unescaped inside a string can make it split in the wrong
 * place, which the per-line pass below catches.
 */
function splitValues(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        out.push(src.slice(start, i + 1));
        start = i + 1;
      }
    } else if (c === '\n' && depth <= 0) {
      if (src.slice(start, i).trim()) out.push(src.slice(start, i));
      start = i + 1;
      depth = 0;
    }
  }
  if (src.slice(start).trim()) out.push(src.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Every piece parsed and an A2UI message, or null. */
function allMessages(pieces: string[]): unknown[] | null {
  if (!pieces.length) return null;
  const out: unknown[] = [];
  for (const piece of pieces) {
    const msgs = asMessages(parseLoose(piece));
    if (!msgs) return null;
    out.push(...msgs);
  }
  return out;
}

/**
 * The asked-for form is one JSON message per line, but smaller models pretty-print, leave a quote
 * unescaped or add a trailing comma, so this tries, in order: the whole block as JSON, its top-level
 * values, its lines, then the whole block repaired. Only A2UI messages count: repair never makes a
 * card out of text that wasn't one.
 */
function parseBlock(body: string): unknown[] | null {
  const src = body.trim();
  if (!src) return null;
  try {
    return asMessages(JSON.parse(src));
  } catch {
    /* not one JSON value */
  }
  return (
    allMessages(splitValues(src)) ??
    allMessages(src.split('\n').filter((l) => l.trim())) ??
    asMessages(parseLoose(src) ?? null)
  );
}

const cache = new Map<string, Extracted>();

/** Memoized per text: the chat re-derives the same message text on every streamed chunk. */
export function extractA2ui(input: string): Extracted {
  const hit = cache.get(input);
  if (hit) return hit;
  const out = extract(input);
  if (cache.size >= 200) cache.delete(cache.keys().next().value as string);
  cache.set(input, out);
  return out;
}

function extract(input: string): Extracted {
  const blocks: unknown[][] = [];
  let invalid = 0;
  const re = /```a2ui[ \t]*\r?\n([\s\S]*?)```/g;
  let text = input.replace(re, (_whole, body: string) => {
    const parsed = parseBlock(body);
    if (parsed) blocks.push(parsed);
    else invalid++;
    return '';
  });
  let pending = false;
  // An unclosed fence is still streaming.
  const open = text.search(/```a2ui[ \t]*(\r?\n(?![\s\S]*```)|$)/);
  if (open >= 0) {
    pending = true;
    text = text.slice(0, open);
  }
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), blocks, pending, invalid };
}
