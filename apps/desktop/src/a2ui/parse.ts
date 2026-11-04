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

function parseBlock(body: string): unknown[] | null {
  const src = body.trim();
  if (!src) return null;
  try {
    const v: unknown = JSON.parse(src);
    return Array.isArray(v) ? v : [v];
  } catch {
    /* maybe JSONL */
  }
  const out: unknown[] = [];
  for (const line of src.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      return null;
    }
  }
  return out.length ? out : null;
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
