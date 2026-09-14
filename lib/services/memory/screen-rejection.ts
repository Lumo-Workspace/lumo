import type { ScreenFailure } from './extraction-gate'

/** Longest constitution excerpt a rejection quotes. */
const MATCH_EXCERPT_CHARS = 160

function clip(s: string): string {
  return s.length > MATCH_EXCERPT_CHARS
    ? `${s.slice(0, MATCH_EXCERPT_CHARS)}…`
    : s
}

/**
 * The user-facing message for a source de-dup rejection (LUM-538 gate,
 * surfaced by the manual `memory add` paths as a 422).
 *
 * LUM-778: the message must be verifiable, not just plausible. A
 * CONSTITUTION_REDUNDANT rejection names the repo whose CLAUDE.md / AGENTS.md
 * it read and quotes the line the candidate restated, so the user can open
 * that file and check the claim instead of guessing what they duplicated.
 * `repo` is null only when no linked repository exists — in which case the
 * constitution is null and this branch cannot fire; the fallback wording is
 * kept for type completeness.
 */
export function formatScreenRejection(
  failure: ScreenFailure,
  repo: string | null
): string {
  switch (failure.reason) {
    case 'INCOMPLETE_FACT':
      return 'Memory rejected: this reads as an incomplete fact — give the headline an actionable claim (what happens / what to do), not a bare fragment.'
    case 'CONSTITUTION_REDUNDANT': {
      const where = repo
        ? `CLAUDE.md / AGENTS.md of ${repo}`
        : 'CLAUDE.md / AGENTS.md'
      return `Memory rejected: it restates a line already in the project constitution (${where}): "${clip(failure.matchedLine)}". Memory is for knowledge not already in code or docs.`
    }
  }
}
