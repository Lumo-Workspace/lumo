export interface DecisionLine {
  number: number
  text: string
  rationale: string | null
  createdAt: Date
}

/**
 * LUM-1303: the task's decisions as a `## Decisions` Markdown block for
 * `task show --full` — by number, each as "Decision N · date", its rationale
 * (if any) on an indented line. "" when there are none.
 */
export function renderDecisionsMarkdown(
  decisions: readonly DecisionLine[]
): string {
  if (decisions.length === 0) return ''
  const lines = decisions.map(d => {
    const day = d.createdAt.toISOString().slice(0, 10)
    const text = d.text.replace(/\s*\n\s*/g, ' ')
    const why = d.rationale?.replace(/\s*\n\s*/g, ' ')
    const head = `- Decision ${d.number} · ${day} · ${text}`
    return why ? `${head}\n  Why: ${why}` : head
  })
  return `## Decisions\n\n${lines.join('\n')}`
}
