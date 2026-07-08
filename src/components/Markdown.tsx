// Markdown renderer with Obsidian-flavored extras, all expressed in plain
// Markdown (no raw HTML, so no injection surface):
//   [[wikilinks]]  -> accent pills that open (or create) the note
//   ==highlight==  -> <mark>
//   #tags          -> clickable pills that search the vault
//   > [!note] ...  -> callout blocks with icon + tint
//   - [ ] tasks    -> checkboxes, clickable in the note reading view
// Inline transforms skip code spans and fenced blocks.

import { Children, isValidElement, useMemo, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle,
  Bug,
  CircleCheck,
  CircleHelp,
  Flame,
  Info,
  Lightbulb,
  List,
  Pencil,
  Quote,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVault } from '../lib/store';
import { getSettings } from '../lib/settings';
import { resolveLink } from '../lib/wikilinks';
import { putRecord } from '../lib/sync';

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
const HIGHLIGHT_RE = /==([^=\n][^=\n]*?)==/g;
const TAG_RE = /(^|\s)#([A-Za-z][\w/-]*)/g;
// Segments that inline transforms must leave alone.
const CODE_RE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`)/g;

// react-markdown's default transform strips unknown URL schemes — which
// silently turned wikilink: hrefs into external links that opened blank tabs.
// Keep our internal schemes intact, sanitize everything else as usual.
const urlTransform = (url: string) =>
  url.startsWith('wikilink:') || url.startsWith('hl:') || url.startsWith('tag:') ? url : defaultUrlTransform(url);

function transformInline(text: string): string {
  return text
    .split(CODE_RE)
    .map((seg, i) => {
      if (i % 2 === 1) return seg; // code segment — untouched
      return seg
        .replace(WIKILINK_RE, (_m, name, alias) => `[${(alias || name).trim()}](wikilink:${encodeURIComponent(name.trim())})`)
        .replace(HIGHLIGHT_RE, (_m, inner) => `[${inner}](hl:x)`)
        .replace(TAG_RE, (_m, pre, tag) => `${pre}[#${tag}](tag:${encodeURIComponent(tag)})`);
    })
    .join('');
}

/* ── callouts ─────────────────────────────────────────────────────────── */

const CALLOUT_ICONS: Record<string, typeof Info> = {
  note: Pencil,
  info: Info,
  todo: List,
  abstract: List,
  summary: List,
  tip: Lightbulb,
  hint: Lightbulb,
  important: Flame,
  success: CircleCheck,
  check: CircleCheck,
  done: CircleCheck,
  question: CircleHelp,
  help: CircleHelp,
  faq: CircleHelp,
  warning: AlertTriangle,
  caution: AlertTriangle,
  attention: AlertTriangle,
  danger: Flame,
  error: Flame,
  failure: Flame,
  bug: Bug,
  example: Pencil,
  quote: Quote,
  cite: Quote,
};

function Callout({ kind, title, children }: { kind: string; title: string; children: ReactNode }) {
  const Icon = CALLOUT_ICONS[kind] ?? Info;
  return (
    <div className={cn('callout', `callout-${kind}`)}>
      <div className="callout-title">
        <Icon className="size-3.5 shrink-0" />
        {title}
      </div>
      {children}
    </div>
  );
}

// A blockquote whose first line is "[!type] Optional title" renders as an
// Obsidian callout; anything else stays a plain quote.
function BlockquoteOrCallout({ children }: { children?: ReactNode }) {
  const items = Children.toArray(children).filter((c) => c !== '\n');
  const first = items[0];
  if (isValidElement<{ children?: ReactNode }>(first)) {
    const inner = Children.toArray(first.props.children);
    const lead = typeof inner[0] === 'string' ? inner[0] : '';
    const nl = lead.indexOf('\n');
    const firstLine = nl === -1 ? lead : lead.slice(0, nl);
    const m = firstLine.match(/^\[!(\w+)\][ \t]*(.*)$/);
    if (m) {
      const kind = m[1].toLowerCase();
      const title = m[2].trim() || kind.charAt(0).toUpperCase() + kind.slice(1);
      const restOfLead = nl === -1 ? '' : lead.slice(nl + 1);
      const restInner = [restOfLead, ...inner.slice(1)].filter((c) => c !== '');
      return (
        <Callout kind={kind} title={title}>
          {restInner.length > 0 && <p>{restInner}</p>}
          {items.slice(1)}
        </Callout>
      );
    }
  }
  return <blockquote>{children}</blockquote>;
}

/* ── renderer ─────────────────────────────────────────────────────────── */

export interface MarkdownProps {
  text: string;
  size?: 'base' | 'sm';
  // When provided, task checkboxes become clickable; called with the ordinal
  // of the task item (document order) and its new checked state.
  onTaskToggle?: (index: number, checked: boolean) => void;
}

export function Markdown({ text, size = 'base', onTaskToggle }: MarkdownProps) {
  const records = useVault((s) => s.records);
  const openFile = useVault((s) => s.openFile);

  const processed = useMemo(() => transformInline(text), [text]);

  return (
    <div className={cn('markdown', size === 'sm' && 'markdown-sm')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={{
          blockquote: BlockquoteOrCallout,
          input(props) {
            if (props.type !== 'checkbox') return <input {...props} />;
            const checked = Boolean(props.checked);
            return (
              <input
                type="checkbox"
                checked={checked}
                disabled={!onTaskToggle}
                className={cn(onTaskToggle && 'task-checkbox cursor-pointer')}
                // The ordinal comes from DOM order at click time (render-pass
                // counters double-count under StrictMode), and the new state
                // flips the source-derived value (the DOM's checked is
                // restored by React before the change event settles).
                onChange={(e) => {
                  const root = (e.target as HTMLElement).closest('.markdown');
                  const boxes = root ? [...root.querySelectorAll('input[type="checkbox"]')] : [];
                  onTaskToggle?.(boxes.indexOf(e.target as HTMLInputElement), !checked);
                }}
              />
            );
          },
          a({ href, children }) {
            if (href?.startsWith('hl:')) return <mark>{children}</mark>;
            if (href?.startsWith('tag:')) {
              const tag = decodeURIComponent(href.slice(4));
              return (
                <a
                  className="tag"
                  href="#"
                  title={`Search #${tag}`}
                  onClick={(e) => {
                    e.preventDefault();
                    window.dispatchEvent(new CustomEvent('vault:search', { detail: `#${tag}` }));
                  }}
                >
                  {children}
                </a>
              );
            }
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
                      openFile(existing, getSettings(records).defaultMode);
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
