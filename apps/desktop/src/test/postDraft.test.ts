import { captionOf, parsePostDraft } from '@/lib/postDraft';

describe('post.json from the agent', () => {
  it('reads a draft: hashtags without # or spaces, the title cut to 100', () => {
    const d = parsePostDraft(JSON.stringify({ title: 'x'.repeat(120), description: ' Satu. ', hashtags: ['#a', 'b c', ''], scheduledAt: '2099-05-01T12:00:00+07:00' }));
    expect(d).toEqual({ title: 'x'.repeat(100), description: 'Satu.', hashtags: ['a', 'bc'], scheduledAt: '2099-05-01T05:00:00.000Z' });
    expect(captionOf(d!)).toBe('Satu.\n\n#a #bc');
  });

  it('drops a time in the past or not a time, and is null for nothing usable', () => {
    expect(parsePostDraft(JSON.stringify({ title: 'T', scheduledAt: '2000-01-01T00:00:00Z' }))?.scheduledAt).toBeNull();
    expect(parsePostDraft(JSON.stringify({ title: 'T', scheduledAt: 'besok' }))?.scheduledAt).toBeNull();
    for (const bad of ['', 'not json', '[]', '{}', JSON.stringify({ hashtags: ['a'] })]) expect(parsePostDraft(bad)).toBeNull();
  });
});
