import type { RichTextBlock, RichTextInline } from '@/lib/seo/blocks/richText';

/**
 * Renders validated SEO block payloads (SEO-05 contract §18).
 *
 * ===========================================================================
 * Reads the exact same constrained rich-text shape `lib/seo/blocks/richText.ts` validates on
 * write — never a second content format, never raw HTML (contract §18, §36).
 * ===========================================================================
 */

function renderInline(node: RichTextInline, key: number): React.ReactElement {
  if (node.type === 'link') {
    return (
      <a key={key} href={node.href}>
        {node.text}
      </a>
    );
  }
  return <span key={key}>{node.text}</span>;
}

function renderBlock(node: RichTextBlock, key: number): React.ReactElement {
  switch (node.type) {
    case 'heading': {
      const Tag = `h${String(node.level)}` as 'h2' | 'h3' | 'h4';
      return <Tag key={key}>{node.children.map((child, index) => renderInline(child, index))}</Tag>;
    }
    case 'list': {
      const ListTag = node.ordered ? 'ol' : 'ul';
      return (
        <ListTag key={key}>
          {node.items.map((item, itemIndex) => (
            <li key={itemIndex}>{item.map((child, index) => renderInline(child, index))}</li>
          ))}
        </ListTag>
      );
    }
    case 'paragraph':
    default:
      return <p key={key}>{node.children.map((child, index) => renderInline(child, index))}</p>;
  }
}

export function RichText({ payload }: { readonly payload: unknown }): React.ReactElement | null {
  const body = payload as { body?: { nodes?: unknown } } | null;
  const nodes = body?.body?.nodes;
  if (!Array.isArray(nodes)) {
    return null;
  }
  return <>{(nodes as RichTextBlock[]).map((node, index) => renderBlock(node, index))}</>;
}

export function Hero({ payload }: { readonly payload: unknown }): React.ReactElement | null {
  const data = payload as { heading?: string; subheading?: string; body?: unknown } | null;
  if (data?.heading === undefined) {
    return null;
  }
  return (
    <header>
      <h1>{data.heading}</h1>
      {data.subheading !== undefined ? <p>{data.subheading}</p> : null}
      {data.body !== undefined ? <RichText payload={{ body: data.body }} /> : null}
    </header>
  );
}

export interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

export function Faq({ payload }: { readonly payload: unknown }): React.ReactElement | null {
  const data = payload as { items?: readonly FaqItem[] } | null;
  if (data?.items === undefined || data.items.length === 0) {
    return null;
  }
  return (
    <section aria-label="Frequently asked questions">
      {data.items.map((item) => (
        <details key={item.question}>
          <summary>{item.question}</summary>
          <p>{item.answer}</p>
        </details>
      ))}
    </section>
  );
}

export interface RelatedLink {
  readonly path: string;
  readonly label: string;
}

export function RelatedLinks({
  title,
  links,
}: {
  readonly title: string;
  readonly links: readonly RelatedLink[];
}): React.ReactElement | null {
  if (links.length === 0) {
    return null;
  }
  return (
    <nav aria-label={title}>
      <h2>{title}</h2>
      <ul>
        {links.map((link) => (
          <li key={link.path}>
            <a href={link.path}>{link.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
