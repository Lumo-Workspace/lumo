export interface PRCard {
  number: number
  title: string
  state: string
  ciStatus: string | null
}

/**
 * Render the "## Pull Requests" section. Each PR becomes a one-line card with
 * number, title, state, and CI rollup, plus the retrieval command for the
 * full diff and review comments.
 */
export function renderPRSection(prs: PRCard[]): string {
  if (prs.length === 0) return ''

  const lines: string[] = ['## Pull Requests', '']

  for (const pr of prs) {
    const ci = pr.ciStatus ?? 'no CI'
    lines.push(`- #${pr.number} ${pr.title} — ${pr.state} · ${ci}`)
    lines.push(`  ↳ diff: lumo task pr show ${pr.number}`)
  }

  return lines.join('\n').trimEnd()
}
