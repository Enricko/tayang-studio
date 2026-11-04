import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { ChatMessage } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({ assetUrl: (p: string) => p }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));
import { openUrl } from '@tauri-apps/plugin-opener';
import { MessageList } from '@/components/MessageList';
import { Markdown } from '@/components/Markdown';
import '@/i18n';

const msg = (role: ChatMessage['role'], text: string): ChatMessage => ({
  id: 'm1',
  chatId: 'c1',
  role,
  parts: [{ type: 'text', text }],
  createdAt: '2026-11-04T00:00:00Z',
});
const agent = (text: string) => render(<MessageList streaming={false} messages={[msg('agent', text)]} />);

describe('Markdown in agent replies', () => {
  it('renders inline formatting as elements', () => {
    const { container } = agent('**Naskah** and *Manhattan* and ~~bumbu~~ and `code`');
    expect(container.querySelector('strong')?.textContent).toBe('Naskah');
    expect(container.querySelector('em')?.textContent).toBe('Manhattan');
    expect(container.querySelector('del')?.textContent).toBe('bumbu');
    expect(container.querySelector('code')?.textContent).toBe('code');
    expect(container.textContent).not.toContain('**');
  });

  it('renders headings, lists, quotes, tables and code blocks', () => {
    const { container } = agent(
      '# H1\n\n- a\n- b\n\n1. one\n\n> quoted\n\n| h | i |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```',
    );
    expect(container.querySelector('h1')).not.toBeNull();
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelector('ol li')).not.toBeNull();
    expect(container.querySelector('blockquote')).not.toBeNull();
    expect(container.querySelector('table th')?.textContent).toBe('h');
    expect(container.querySelector('pre code')?.textContent).toContain('const x = 1;');
    expect(screen.getByText('ts')).toBeInTheDocument();
  });

  it('renders an unclosed code fence as a code block', () => {
    const { container } = agent('Here:\n\n```js\nlet a = 1');
    expect(container.querySelector('pre code')?.textContent).toContain('let a = 1');
  });

  it('never renders raw HTML or images', () => {
    const { container } = agent('<script>alert(1)</script>\n\nhi <img src=x onerror="alert(1)"> there\n\n![pic](http://e.com/a.png)');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img:not([alt="Oyen"])')).toBeNull();
    expect(container.textContent).toContain('pic');
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.textContent).toContain('onerror');
  });

  it('does not make a link of a javascript: href', () => {
    const { container } = agent('[bad](javascript:alert(1)) and [ok](https://example.com)');
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull();
    expect(container.textContent).toContain('bad');
    expect(screen.getByRole('link', { name: 'ok' })).toHaveAttribute('title', 'https://example.com');
  });

  it('opens an http link with openUrl and does not navigate', async () => {
    agent('[ok](https://example.com)');
    await userEvent.click(screen.getByRole('link', { name: 'ok' }));
    expect(openUrl).toHaveBeenCalledWith('https://example.com');
  });

  it('copies a code block and shows the check state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Markdown text={'```\nhello\n```'} />);
    const btn = screen.getByRole('button', { name: 'Copy code' });
    await userEvent.click(btn);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('hello'));
    expect(btn.querySelector('svg.lucide-check')).not.toBeNull();
  });

  it('keeps user messages literal', () => {
    render(<MessageList streaming={false} messages={[msg('user', '**x**')]} />);
    expect(screen.getByText('**x**')).toBeInTheDocument();
  });
});
