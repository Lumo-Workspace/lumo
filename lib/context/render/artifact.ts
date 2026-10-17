import { shortRef } from '@/shared/src/short-ref'
import { agentLabel } from '@/lib/agents/agent-label'

export interface ArtifactCard {
  id: string
  kind: string
  title: string
  content: string
  agent?: string | null
  summary?: string | null
}

const FALLBACK_CONTENT_LINES = 5

/**
 * Render the artifact section. Each artifact becomes a cheap card: a
 * `## [kind] title · agent` heading, the cached one-line `summary` (or the
 * first few content lines as a fallback when no summary exists yet), and the
 * retrieval command for the full content. Content is no longer inlined.
 *
 * `identifier` is the LUM-N task identifier — the first positional of the
 * on-demand fetch command, not the cuid.
 */
export function renderArtifactSection(
  artifacts: ArtifactCard[],
  identifier: string
): string {
  if (artifacts.length === 0) return ''
  const blocks: string[] = []
  for (const a of artifacts) {
    const label = a.agent ? agentLabel(a.agent) : null
    const heading = label
      ? `## [${a.kind}] ${a.title} · ${label}`
      : `## [${a.kind}] ${a.title}`
    blocks.push(heading)
    blocks.push('')

    const summary = a.summary?.trim()
    if (summary) {
      blocks.push(summary)
    } else {
      // Fallback: no summary cached yet → show the first few content lines so
      // the card still carries signal.
      const preview = a.content
        .split('\n')
        .slice(0, FALLBACK_CONTENT_LINES)
        .join('\n')
        .trimEnd()
      if (preview) blocks.push(preview)
    }

    blocks.push(
      `  ↳ full text: lumo task artifact show ${identifier} ${shortRef(a.id)}`
    )
    blocks.push('')
  }
  return blocks.join('\n').trimEnd()
}
