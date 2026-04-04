import { marked } from 'marked'

// @ts-ignore — turndown is CJS; bundler interop may wrap as { default }
import TurndownModule from 'turndown'

type TurndownCtor = new (options?: object) => { turndown(html: string): string }

const TurndownService: TurndownCtor =
  typeof TurndownModule === 'function'
    ? (TurndownModule as unknown as TurndownCtor)
    : (TurndownModule as unknown as { default: TurndownCtor }).default

export function isHtml(text: string): boolean {
  return /<(?:p|div|span|br|h[1-6]|ul|ol|li|a\b|strong|em|code|pre|blockquote|table|img\b)[>\s/]/i.test(
    text
  )
}

export function markdownToHtml(md: string): string {
  if (isHtml(md)) return md
  return marked.parse(md, { async: false }) as string
}

export function htmlToMarkdown(html: string): string {
  if (!isHtml(html)) return html
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })
  return turndown.turndown(html)
}
