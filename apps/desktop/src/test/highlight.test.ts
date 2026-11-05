import { describe, expect, it } from 'vitest';
import { HIGHLIGHT_MAX, highlight, languageFor } from '@/lib/highlight';

describe('highlight', () => {
  it('knows the languages of a video project by extension', () => {
    expect(languageFor('Video.tsx')).toBe('tsx');
    expect(languageFor('index.html')).toBe('html');
    expect(languageFor('hyperframes.json')).toBe('json');
    expect(languageFor('AGENTS.md')).toBe('markdown');
    expect(languageFor('Makefile')).toBeNull();
    expect(languageFor('notes.xyz')).toBeNull();
  });

  it('colours code with Shiki and escapes the file text', async () => {
    const html = await highlight('const a = "<script>alert(1)</script>";', 'a.ts');
    expect(html).toContain('class="shiki');
    expect(html).toContain('class="line"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&#x3C;script>');
  }, 20_000);

  it('leaves plain text and very long files uncoloured', async () => {
    expect(await highlight('hello', 'notes.xyz')).toBeNull();
    expect(await highlight('x'.repeat(HIGHLIGHT_MAX + 1), 'a.ts')).toBeNull();
  });
});
