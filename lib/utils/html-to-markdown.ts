// @ts-ignore — turndown is CJS; bundler interop may wrap as { default }
import TurndownModule from 'turndown'
import { BLOCK_TAGS, tagGroup } from './html-tags'

type TurndownCtor = new (options?: object) => { turndown(html: string): string }

/** Resolve CJS/ESM interop: bundler may deliver the class directly or as { default } */
const TurndownService: TurndownCtor =
  typeof TurndownModule === 'function'
    ? (TurndownModule as unknown as TurndownCtor)
    : (TurndownModule as unknown as { default: TurndownCtor }).default

/**
 * The permissive containment check: matches the shared block-level core
 * plus inline tags, list items, and images — i.e. *any* rich-text tag
 * appearing *anywhere* in the string. `a`/`img` carry a word boundary so
 * `<article>` / `<image>` don't false-match, and the group is followed by
 * `[>\s/]` to require a tag terminator (so `<pre-release` isn't HTML).
 *
 * Deliberately broader than `looksLikeHtmlDocument`; the divergence is
 * load-bearing — see `normalizeRichText`.
 */
const HTML_CONTAINS = new RegExp(
  `<(?:${tagGroup(...BLOCK_TAGS, 'span', 'br', 'li', 'a\\b', 'strong', 'em', 'code', 'img\\b')})[>\\s/]`,
  'i'
)

/**
 * Detect whether a string is likely HTML (as opposed to plain markdown).
 * Looks for common HTML tags that would appear in rich-text content.
 */
export function isHtml(text: string): boolean {
  return HTML_CONTAINS.test(text)
}

/**
 * Convert HTML back to Markdown. If the input doesn't look like HTML,
 * returns it as-is (treating it as already-markdown).
 *
 * Lives in its own module so callers that only need this direction
 * (e.g. the documents service rendering a stored HTML body back to
 * markdown for the CLI) don't drag the marked ESM build into their
 * import graph.
 */
export function htmlToMarkdown(html: string): string {
  if (!isHtml(html)) return html
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })
  return turndown.turndown(html)
}
