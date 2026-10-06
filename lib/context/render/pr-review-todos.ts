import { guardPromptLineText } from '@/lib/security-scan/inject-guard'

export interface ReviewTodoItem {
  /** `line` = a line-level review comment; `overall` = a changes-requested review summary. */
  kind: 'line' | 'overall'
  /** The PR this comment lives on — used to label todos when a task spans >1 PR. */
  prNumber: number
  filePath: string | null
  line: number | null
  /** Plain text: header marker stripped, HTML removed, whitespace collapsed. */
  text: string
  /** Deep link to the comment on GitHub. */
  url: string
  /** Reviewer handle (GitHub login) when known, else null. */
  author: string | null
}

/**
 * Render the "## PR review todos" section: mirrored PR review comments as a
 * checkbox todo list so the agent treats each reviewer ask as an item to
 * resolve. Line-level comments show `file:line`; changes-requested summaries
 * show a "Changes requested (whole PR)" marker. Each item links back to the
 * GitHub comment.
 *
 * Returns "" when there are no todos (the formatter then skips the section).
 */
export function renderPrReviewTodosSection(todos: ReviewTodoItem[]): string {
  if (todos.length === 0) return ''

  const multiPr = new Set(todos.map(t => t.prNumber)).size > 1
  const lines: string[] = ['## PR review todos', '']

  for (const t of todos) {
    const prefix = multiPr ? `[#${t.prNumber}] ` : ''
    const who = t.author ? ` (@${t.author})` : ''

    let head: string
    if (t.kind === 'line' && t.filePath) {
      const loc = t.line != null ? `${t.filePath}:${t.line}` : t.filePath
      head = `\`${loc}\``
    } else {
      head = '🛑 Changes requested (whole PR)'
    }

    // LUM-998: the comment text is a GitHub reviewer's — anyone who can
    // comment on the PR. It stays an actionable todo (no "do not obey"
    // fence), but it is redacted, defanged and marked inline when it is
    // directive-shaped, on both the task-context and session-start paths.
    const text = t.text ? ` — ${guardPromptLineText(t.text)}` : ''
    lines.push(`- [ ] ${prefix}${head}${who}${text}`)
    lines.push(`  ↳ ${t.url}`)
  }

  return lines.join('\n').trimEnd()
}
