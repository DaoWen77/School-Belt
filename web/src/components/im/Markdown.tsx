'use client';

import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { parseMentions } from '@/lib/format';
import { CopyIcon } from './icons';

/** 白名单：不启用 raw HTML，只用 react-markdown 的安全 AST。 */
const ALLOWED = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'a',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'span',
];

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: ReactNode } }).props.children);
  return '';
}

function mentionNodes(children: ReactNode): ReactNode {
  return (Array.isArray(children) ? children : [children]).flatMap((child, index) => {
    if (typeof child !== 'string') return child;
    return parseMentions(child).map((part, partIndex) =>
      part.mention ? (
        <span key={`${index}-${partIndex}`} className="bg-accent px-0.5 font-semibold text-on-accent">
          {part.text}
        </span>
      ) : (
        <span key={`${index}-${partIndex}`}>{part.text}</span>
      ),
    );
  });
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const child = Array.isArray(children) ? children[0] : children;
  const className =
    child && typeof child === 'object' && 'props' in child
      ? String((child as { props?: { className?: string } }).props?.className ?? '')
      : '';
  const language = /language-([\w-]+)/.exec(className)?.[1] ?? 'text';
  const source = textOf(children).replace(/\n$/, '');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{language}</span>
        <button type="button" onClick={() => void copy()} className="md-code-copy" aria-label="复制代码">
          <CopyIcon size={11} /> {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export function Markdown({ text, mentions = false }: { text: string; mentions?: boolean }) {
  return (
    <div className="im-markdown text-[13px] leading-relaxed text-ink">
      <ReactMarkdown
        allowedElements={ALLOWED}
        unwrapDisallowed
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener" className="underline decoration-accent decoration-2 underline-offset-2">
              {children}
            </a>
          ),
          ...(mentions
            ? {
                p: ({ children }) => <p className="whitespace-pre-wrap">{mentionNodes(children)}</p>,
                li: ({ children }) => <li>{mentionNodes(children)}</li>,
              }
            : {}),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
