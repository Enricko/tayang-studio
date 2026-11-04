/** Minimal JSON Pointer (RFC 6901) helpers over plain JSON values. Never mutate the input. */
export type Json = unknown;

export function parsePointer(path: string | undefined): string[] {
  if (!path || path === '/') return [];
  return path
    .replace(/^\//, '')
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const unsafe = (k: string) => k === '__proto__' || k === 'constructor' || k === 'prototype';

export function getAt(root: Json, path: string | undefined): Json {
  let cur = root;
  for (const k of parsePointer(path)) {
    if (!isObj(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Returns a new root with `value` set at `path`; `undefined` deletes. */
export function setAt(root: Json, path: string | undefined, value: Json): Json {
  const keys = parsePointer(path);
  if (keys.some(unsafe)) return root;
  const go = (node: Json, i: number): Json => {
    if (i === keys.length) return value;
    const k = keys[i]!;
    const last = i === keys.length - 1;
    const numeric = /^\d+$/.test(k);
    if (numeric && (Array.isArray(node) || node === undefined || node === null)) {
      const copy = Array.isArray(node) ? [...node] : [];
      const idx = Number(k);
      if (idx > copy.length) return node; // no sparse writes
      if (last && value === undefined) copy.splice(idx, 1);
      else copy[idx] = go(copy[idx], i + 1);
      return copy;
    }
    const copy: Record<string, unknown> = isObj(node) && !Array.isArray(node) ? { ...node } : {};
    if (last && value === undefined) delete copy[k];
    else copy[k] = go(copy[k], i + 1);
    return copy;
  };
  const out = go(root, 0);
  return out === undefined ? {} : out;
}
