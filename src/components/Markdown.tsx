// Markdown renderer with [[wikilink]] support: link syntax is rewritten to
// pills that open (or create) the target note on click — Notion-style.

import { useMemo } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { useVault } from '../lib/store';
import { resolveLink } from '../lib/wikilinks';
import { putRecord } from '../lib/sync';

const LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

// react-markdown's default transform strips unknown URL schemes — which
// silently turned wikilink: hrefs into external links that opened blank tabs.
// Keep our internal scheme intact, sanitize everything else as usual.
const urlTransform = (url: string) => (url.startsWith('wikilink:') ? url : defaultUrlTransform(url));

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
        urlTransform={urlTransform}
        components={{
          a({ href, children }) {
            if (href?.startsWith('wikilink:')) {
              const name = decodeURIComponent(href.slice(9));
              const existing = resolveLink(records, name);
              return (
                <a
                  className={cn('wikilink', !existing && 'wikilink-new')}
                  href="#"
                  title={existing ?? `Create "${name}"`}
                  onClick={async (e) => {
                    e.preventDefault();
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
