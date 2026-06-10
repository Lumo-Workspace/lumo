import { makeBudgetSection } from '@/lib/context/budget'

export interface PRCard {
  number: number
  title: string
  state: string
  ciStatus: string | null
}

/** Render a single PR card body (no section heading). */
export function prCard(pr: PRCard): string {
  const ci = pr.ciStatus ?? 'no CI'
  // LUM-347: entry-level source attribution — synced GitHub PR metadata.
  return [
    `- [external:github] #${pr.number} ${pr.title} — ${pr.state} · ${ci}`,
    `  ↳ diff: lumo task pr show ${pr.number}`,
  ].join('\n')
}

/** One-line manifest for an overflowed PR. */
export function prManifest(pr: PRCard): string {
  return `- [external:github] #${pr.number} ${pr.title} — lumo task pr show ${pr.number}`
}

/**
 * Render the "## Pull Requests" section. Unchanged public output; now composed
 * from `prCard`.
 */
export function renderPRSection(prs: PRCard[]): string {
  if (prs.length === 0) return ''
  const lines: string[] = ['## Pull Requests', '']
  for (const pr of prs) lines.push(prCard(pr))
  return lines.join('\n').trimEnd()
}

/** Budget-section wrapper for PRs (LUM-147). */
export function prBudgetSection(prs: PRCard[]) {
  return makeBudgetSection('## Pull Requests', prs, prCard, prManifest, '\n')
}
