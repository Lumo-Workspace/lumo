// @ts-ignore — turndown is CJS; bundler interop may wrap as { default }
import TurndownModule from 'turndown'

type TurndownCtor = new (options?: object) => { turndown(html: string): string }

/** Resolve CJS/ESM interop: bundler may deliver the class directly or as { default } */
const TurndownService: TurndownCtor =
  typeof TurndownModule === 'function'
    ? (TurndownModule as unknown as TurndownCtor)
    : (TurndownModule as unknown as { default: TurndownCtor }).default

/**
 * Detect whether a string is likely HTML (as opposed to plain markdown).
 * Looks for common HTML tags that would appear in rich-text content.
 */
export function isHtml(text: string): boolean {
  return /<(?:p|div|span|br|h[1-6]|ul|ol|li|a\b|strong|em|code|pre|blockquote|table|img\b)[>\s/]/i.test(
    text
  )
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
