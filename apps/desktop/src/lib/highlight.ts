import type { HighlighterCore } from 'shiki/core';

/** File extension → the Shiki language that reads it. Anything else is shown as plain text. */
const LANGS: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  css: 'css',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'shellscript',
  bash: 'shellscript',
  toml: 'toml',
  rs: 'rust',
  py: 'python',
  xml: 'xml',
};

export const THEME = 'github-dark-default';

/** The Shiki language for a file name, or null for plain text. */
export function languageFor(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return name.includes('.') ? (LANGS[ext] ?? null) : null;
}

let loading: Promise<HighlighterCore> | null = null;

/** One highlighter for the app, loaded the first time a file is shown (the JS regex engine: no wasm). */
function highlighter(): Promise<HighlighterCore> {
  loading ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ]);
    return createHighlighterCore({
      themes: [import('shiki/themes/github-dark-default.mjs')],
      langs: [
        import('shiki/langs/typescript.mjs'),
        import('shiki/langs/tsx.mjs'),
        import('shiki/langs/javascript.mjs'),
        import('shiki/langs/jsx.mjs'),
        import('shiki/langs/json.mjs'),
        import('shiki/langs/css.mjs'),
        import('shiki/langs/html.mjs'),
        import('shiki/langs/markdown.mjs'),
        import('shiki/langs/yaml.mjs'),
        import('shiki/langs/shellscript.mjs'),
        import('shiki/langs/toml.mjs'),
        import('shiki/langs/rust.mjs'),
        import('shiki/langs/python.mjs'),
        import('shiki/langs/xml.mjs'),
      ],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/** Longest text that is coloured; longer files are shown plain (colouring them would stall the window). */
export const HIGHLIGHT_MAX = 200_000;

/**
 * Highlighted HTML for `code` as `<pre class="shiki"><code><span class="line">…`, or null when the
 * file is plain text, too long, or the highlighter can't load. Shiki escapes the text itself.
 */
export async function highlight(code: string, name: string): Promise<string | null> {
  const lang = languageFor(name);
  if (!lang || code.length > HIGHLIGHT_MAX) return null;
  try {
    return (await highlighter()).codeToHtml(code, { lang, theme: THEME });
  } catch {
    return null;
  }
}
