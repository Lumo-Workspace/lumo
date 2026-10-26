import { Marked } from 'marked'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const SAFE_HREF = /^(https?:|mailto:)/i

/**
 * Inline-Markdown renderer for decision text. Raw HTML in the text is shown
 * as text, never rendered as markup, links keep only http(s)/mailto hrefs,
 * and images render as their alt text — an <img> would load from any URL for
 * everyone who opens the task (a tracking pixel). Decisions come from CLI
 * arguments and form input, so they are untrusted.
 */
const decisionMarked = new Marked({
  renderer: {
    html({ text }) {
      return escapeHtml(text)
    },
    image({ text }) {
      return escapeHtml(text)
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens)
      return SAFE_HREF.test(href)
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : label
    },
  },
})

/** Classes for an element holding {@link renderDecisionInline} output. */
export const DECISION_INLINE_CLASS =
  '[&_a]:underline [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:text-caption'

/**
 * LUM-1303: render one decision's text (or rationale) — inline Markdown
 * (`code`, **bold**, links) — to safe HTML. Line breaks become spaces.
 */
export function renderDecisionInline(text: string): string {
  return (decisionMarked.parseInline(text.trim(), { async: false }) as string)
    .replace(/\n+/g, ' ')
    .trim()
}
