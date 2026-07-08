// Markdown renderer with [[wikilink]] support: link syntax is rewritten to
// pills that open (or create) the target note on click — Notion-style.

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { useVault } from '../lib/store';
import { resolveLink } from '../lib/wikilinks';
import { putRecord } from '../lib/sync';

const LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

export function Markdown({ text, size = 'base' }: { text: string; size?: 'base' | 'sm' }) {
  const records = useVault((s) => s.records);
  const openFile = useVault((s) => s.openFile);

  const processed = useMemo(
    () =>
      text.replace(LINK_RE, (_m, name, alias) => `[${(alias || name).trim()}](wikilink:${encodeURIComponent(name.trim())})`),
    [text]
  );

  return (
    <div className={cn('markdown', size === 'sm' && 'markdown-sm')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            if (href?.startsWith('wikilink:')) {
              const name = decodeURIComponent(href.slice(9));
              return (
                <a
                  className="wikilink"
                  href="#"
                  onClick={async (e) => {
                    e.preventDefault();
                    const existing = resolveLink(records, name);
                    if (existing) {
                      openFile(existing, 'read');
                    } else {
                      const path = `notes/${name}.md`;
                      await putRecord(path, 'file', `# ${name}\n`);
                      openFile(path, 'edit');
                    }
                  }}
                >
                  {children}
                </a>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
