/**
 * LUM-775 — the queue's exit door, derived at read time.
 *
 * Every consumer of undispositioned findings (session-start / PreToolUse
 * reminders, `lumo task status`, the DONE gate, the web panel, the analysis
 * report) asks this one predicate whether a row on a merged or closed PR is
 * still the task's business. Pure: no I/O, no Prisma, so the LLM-free gate
 * can import it statically.
 *
 * The rules (spec docs/superpowers/specs/2026-09-14-lum775-finding-queue-exit-design.md §2):
 *
 *   open PR                                          → stays
 *   closed (unmerged) PR                             → PR_CLOSED
 *   merged, EXTERNAL_TOOL, absent from a baseline
 *     that can testify                               → RESOLVED_ON_MAIN
 *   merged, blocking under the workspace policy      → stays (human decides)
 *   merged, advisory                                 → MERGED_UNREVIEWED
 *
 * Fail-closed throughout: a baseline that is missing, in flight, partial,
 * older than the merge, or that never ran the tool cannot testify, and an
 * unknown PR state reads as open. Nothing here is a verdict on the finding
 * — RESOLVED_ON_MAIN says main no longer carries it, not that it was benign.
 */
import type { QueueExitReason } from '@/shared/src/security-scan'
import {
  isBlockingUnderPolicy,
  type PolicyFindingInput,
  type SecurityPolicy,
} from './policy'
import type { SecurityBaseline } from './types'

export type { QueueExitReason }

export interface QueueExitPr {
  /** `PullRequest.state`: "open" | "closed" | "merged" (free text on the row). */
  state: string
  mergedAt: Date | null
}

export interface QueueExitFinding extends PolicyFindingInput {
  ruleId: string
  fingerprint: string
}

/** One repo's baseline with its fingerprint set built once (up to 5000 entries). */
export interface QueueExitContext {
  baseline: SecurityBaseline | null
  fingerprints: ReadonlySet<string>
}

export function queueExitContext(
  baseline: SecurityBaseline | null | undefined
): QueueExitContext {
  return {
    baseline: baseline ?? null,
    fingerprints: new Set(baseline?.fingerprints ?? []),
  }
}

/** `ext:<tool-slug>:<rule>` → `<tool-slug>`; null for Lumo's own layers. */
export function externalToolSlug(ruleId: string): string | null {
  if (!ruleId.startsWith('ext:')) return null
  const slug = ruleId.slice('ext:'.length).split(':')[0] ?? ''
  return slug.length > 0 ? slug : null
}

export type BaselineVouch =
  | { kind: 'absent' }
  | { kind: 'present' }
  | { kind: 'cannot'; why: string }

/**
 * Whether the baseline may testify about a merged PR's finding, and what it
 * says. It may only when it landed (`at`), is whole (`!partial`), was
 * requested after the merge (so the merged tree is what it scanned) and ran
 * the finding's tool. `fingerprint` is optional so callers that only need the
 * eligibility check can omit it.
 */
export function baselineVouch(
  ctx: QueueExitContext,
  pr: QueueExitPr,
  toolSlug: string,
  fingerprint?: string
): BaselineVouch {
  const b = ctx.baseline
  if (!b) return { kind: 'cannot', why: 'no baseline' }
  if (b.at === null) return { kind: 'cannot', why: 'baseline in flight' }
  if (b.partial) return { kind: 'cannot', why: 'baseline partial' }
  if (!pr.mergedAt) return { kind: 'cannot', why: 'merge undated' }
  const requested = Date.parse(b.requestedAt)
  if (!Number.isFinite(requested) || requested <= pr.mergedAt.getTime())
    return { kind: 'cannot', why: 'baseline predates merge' }
  if (!b.tools.includes(toolSlug))
    return { kind: 'cannot', why: 'tool not in baseline' }
  if (fingerprint !== undefined && ctx.fingerprints.has(fingerprint))
    return { kind: 'present' }
  return { kind: 'absent' }
}

export interface QueueExitExplanation {
  exit: QueueExitReason | null
  /** Plain words for the report: the exit's evidence, or why the row stays. */
  why: string
}

export function explainQueueExit(
  f: QueueExitFinding,
  pr: QueueExitPr,
  ctx: QueueExitContext,
  policy: SecurityPolicy
): QueueExitExplanation {
  if (f.disposition !== null) return { exit: null, why: 'dispositioned' }
  if (f.persisting) return { exit: null, why: 'persisting' }
  if (pr.state === 'open') return { exit: null, why: 'PR open' }
  if (pr.state === 'closed')
    return { exit: 'PR_CLOSED', why: 'PR closed unmerged' }
  if (pr.state !== 'merged')
    return { exit: null, why: `PR state ${pr.state} (treated as open)` }
  const slug =
    f.provenance === 'EXTERNAL_TOOL' ? externalToolSlug(f.ruleId) : null
  const vouch: BaselineVouch = slug
    ? baselineVouch(ctx, pr, slug, f.fingerprint)
    : { kind: 'cannot', why: 'not an external-tool finding' }
  if (vouch.kind === 'absent')
    return {
      exit: 'RESOLVED_ON_MAIN',
      why: 'absent from default-branch baseline',
    }
  const baselineNote =
    vouch.kind === 'present'
      ? 'still in default-branch baseline'
      : `baseline cannot vouch (${vouch.why})`
  if (isBlockingUnderPolicy(f, policy))
    return { exit: null, why: `blocking under policy; ${baselineNote}` }
  return { exit: 'MERGED_UNREVIEWED', why: `advisory; ${baselineNote}` }
}

export function queueExitReason(
  f: QueueExitFinding,
  pr: QueueExitPr,
  ctx: QueueExitContext,
  policy: SecurityPolicy
): QueueExitReason | null {
  return explainQueueExit(f, pr, ctx, policy).exit
}
