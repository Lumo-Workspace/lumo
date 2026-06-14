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

/**
 * Truncate a one-line descriptor for a manifest line. Collapses internal
 * whitespace, then clips at `max` chars with an ellipsis. Returns "" for
 * empty/whitespace-only input.
 */
function truncateDescriptor(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length === 0) return ''
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * One-line manifest for a Tier-2 PR (LUM-500): number + a truncated title so
 * an agent can decide whether to pull the diff, plus the retrieval hint.
 */
export function prManifest(pr: PRCard): string {
  const title = truncateDescriptor(pr.title)
  const descriptor = title ? `#${pr.number} ${title}` : `#${pr.number}`
  return `- [external:github] ${descriptor} → lumo task pr show ${pr.number}`
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
