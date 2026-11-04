import { memo, useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';

const SAFE_LINK = /^(https?:|mailto:)/i;

function nodeText(n: ReactNode): string {
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(nodeText).join('');
  if (n && typeof n === 'object' && 'props' in n) return nodeText((n as { props: { children?: ReactNode } }).props.children);
  return '';
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const code = (children as { props?: { className?: string; children?: ReactNode } } | undefined)?.props;
  const lang = /language-([\w+-]+)/.exec(code?.className ?? '')?.[1];
  const text = nodeText(code?.children).replace(/\n$/, '');
  const copy = () => {
    void Promise.resolve(navigator.clipboard?.writeText(text)).then(() => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="relative my-2 first:mt-0 last:mb-0">
      {lang && <span className="absolute left-3 top-1.5 text-[11px] text-text-3">{lang}</span>}
      <button
        type="button"
        aria-label={t('chat.copyCode')}
        onClick={copy}
        className="absolute right-2 top-1.5 inline-flex size-6 items-center justify-center rounded-sm text-text-3 hover:text-foreground"
      >
        {copied ? <Check size={14} strokeWidth={1.5} aria-hidden="true" /> : <Copy size={14} strokeWidth={1.5} aria-hidden="true" />}
      </button>
      <pre className={`m-0 overflow-x-auto rounded-md border border-border bg-[#101010] p-3 font-mono text-[12.5px] leading-[1.55] ${lang ? 'pt-7' : ''}`}>
        {children}
      </pre>
    </div>
  );
}

const block = 'my-2 first:mt-0 last:mb-0';
const components: Components = {
  p: (p) => <p className={`${block} text-[14px] leading-[1.6] text-[#D9D9D9]`}>{p.children}</p>,
  strong: (p) => <strong className="font-semibold text-foreground">{p.children}</strong>,
  em: (p) => <em className="italic">{p.children}</em>,
  del: (p) => <del className="text-text-3 line-through">{p.children}</del>,
  h1: (p) => <h1 className="mb-1 mt-3 text-[16px] font-semibold text-foreground first:mt-0">{p.children}</h1>,
  h2: (p) => <h2 className="mb-1 mt-3 text-[15px] font-semibold text-foreground first:mt-0">{p.children}</h2>,
  h3: (p) => <h3 className="mb-1 mt-3 text-[14px] font-semibold text-foreground first:mt-0">{p.children}</h3>,
  h4: (p) => <h4 className="mb-1 mt-3 text-[14px] font-semibold text-foreground first:mt-0">{p.children}</h4>,
  h5: (p) => <h5 className="mb-1 mt-3 text-[14px] font-semibold text-foreground first:mt-0">{p.children}</h5>,
  h6: (p) => <h6 className="mb-1 mt-3 text-[14px] font-semibold text-foreground first:mt-0">{p.children}</h6>,
  ul: ({ children, className }) => (
    <ul className={`${block} list-disc pl-5 text-[14px] leading-[1.6] text-[#D9D9D9] marker:text-text-3 ${className?.includes('contains-task-list') ? 'list-none pl-0' : ''}`}>
      {children}
    </ul>
  ),
  ol: (p) => <ol className={`${block} list-decimal pl-5 text-[14px] leading-[1.6] text-[#D9D9D9] marker:text-text-3`}>{p.children}</ol>,
  li: (p) => <li className="my-0.5">{p.children}</li>,
  input: (p: ComponentPropsWithoutRef<'input'>) => <input type="checkbox" checked={!!p.checked} disabled readOnly className="mr-1.5 align-middle" />,
  blockquote: (p) => <blockquote className={`${block} border-l-2 border-border pl-3 text-text-2`}>{p.children}</blockquote>,
  hr: () => <hr className="my-3 border-border" />,
  pre: (p) => <CodeBlock>{p.children}</CodeBlock>,
  code: ({ className, children }) =>
    className?.includes('language-') ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded-sm bg-raised px-1 py-0.5 font-mono text-[12.5px]">{children}</code>
    ),
  table: (p) => (
    <div className={`${block} overflow-x-auto`}>
      <table className="border-collapse text-[14px] text-[#D9D9D9]">{p.children}</table>
    </div>
  ),
  th: (p) => <th className="border border-border px-2 py-1 text-left font-medium text-foreground">{p.children}</th>,
  td: (p) => <td className="border border-border px-2 py-1">{p.children}</td>,
  img: ({ alt }) => (alt ? <span className="text-text-3">{alt}</span> : null),
  a: ({ href, children }) => {
    if (!href || !SAFE_LINK.test(href)) return <>{children}</>;
    return (
      <a
        href={href}
        title={href}
        className="text-orange-light underline underline-offset-2 hover:text-primary"
        onClick={(e) => {
          e.preventDefault();
          void openUrl(href);
        }}
      >
        {children}
      </a>
    );
  },
};

const plugins = [remarkGfm];

/** Agent prose as Markdown: no raw HTML, no images, links open outside the webview. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="min-w-0">
      <ReactMarkdown remarkPlugins={plugins} skipHtml urlTransform={(u) => u} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
