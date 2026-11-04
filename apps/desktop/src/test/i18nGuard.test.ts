import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Screens and components must not carry English copy of their own: JSX text, and the text attributes
 * a screen reader or tooltip shows, go through `t(...)`. A parser (not a regex) finds them. Put
 * `i18n-ignore` in a comment on the same or the line above to allow a deliberate exception.
 */
const SRC = resolve(__dirname, '..');
const ROOTS = ['screens', 'components'].map((d) => join(SRC, d));
/** shadcn primitives are not ours to translate; their one visible string is `common.close`. */
const SKIP = [join(SRC, 'components', 'ui')];
const ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt']);
/** Names that stay as they are in every language. */
const BRANDS = [
  'Tayang', 'Claude Code', 'Claude', 'opencode', 'Codex', 'Gemini CLI', 'Gemini', 'HyperFrames', 'Remotion',
  'ElevenLabs', 'FFmpeg', 'yt-dlp', 'Node.js', 'Chrome', 'Oyen', 'TikTok', 'Instagram', 'Reels', 'YouTube', 'ACP', 'MCP',
  'sk_', 'Shift', 'Esc', 'MP4', 'API', 'Bahasa Indonesia', 'English',
];

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (SKIP.includes(p)) return [];
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });

/** Whether `text` has a word of plain English once brand names are taken out. */
export function hasCopy(text: string): boolean {
  let rest = text;
  for (const b of BRANDS) rest = rest.split(b).join(' ');
  return /[A-Za-z]{2,}/.test(rest);
}

export function findCopy(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = source.split('\n');
  const hits: string[] = [];
  const ignored = (pos: number) => {
    const line = sf.getLineAndCharacterOfPosition(pos).line;
    return /i18n-ignore/.test(lines[line] ?? '') || /i18n-ignore/.test(lines[line - 1] ?? '');
  };
  const report = (node: ts.Node, text: string) => {
    const start = node.getStart(sf);
    if (ignored(start)) return;
    hits.push(`${relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(start).line + 1}  ${JSON.stringify(text.trim().slice(0, 60))}`);
  };
  /** String literals a JSX expression can show: through ?:, && and ||. */
  const literals = (e: ts.Expression, out: ts.Node[] = []): ts.Node[] => {
    if (ts.isParenthesizedExpression(e)) return literals(e.expression, out);
    if (ts.isConditionalExpression(e)) return literals(e.whenTrue, literals(e.whenFalse, out));
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      // `a && 'text'` shows the right side; comparisons show nothing
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) return literals(e.right, out);
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) return literals(e.left, literals(e.right, out));
    }
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) out.push(e);
    return out;
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      if (hasCopy(node.text)) report(node, node.text);
    } else if (ts.isJsxAttribute(node) && ATTRS.has(node.name.getText(sf))) {
      const init = node.initializer;
      if (init && ts.isStringLiteral(init) && hasCopy(init.text)) report(init, init.text);
      if (init && ts.isJsxExpression(init) && init.expression) {
        for (const l of literals(init.expression)) if (hasCopy((l as ts.StringLiteral).text)) report(l, (l as ts.StringLiteral).text);
      }
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      for (const l of literals(node.expression)) if (hasCopy((l as ts.StringLiteral).text)) report(l, (l as ts.StringLiteral).text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe('no English copy outside t()', () => {
  it('finds none in screens and components', () => {
    const found = ROOTS.flatMap(files).flatMap((f) => findCopy(f, readFileSync(f, 'utf8')));
    expect(found).toEqual([]);
  });

  it('does catch text, attributes and string literals, and lets brands and marked lines through', () => {
    const bad = `export const A = () => <div title="Close it" aria-label={x ? 'Open' : t('a')}>Hello there{ok && 'Saved'}</div>;`;
    expect(findCopy('a.tsx', bad)).toHaveLength(4);
    const fine = [
      `export const B = () => <div title={t('a')}>{t('b')} · Claude Code · yt-dlp {'→'}</div>;`,
      `export const C = () => <p>\n  {/* i18n-ignore: a sample */}\n  Kenapa rupiah melemah?\n</p>;`,
    ];
    for (const src of fine) expect(findCopy('b.tsx', src)).toEqual([]);
  });
});
