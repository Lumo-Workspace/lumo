/**
 * LUM-732 — Prisma access for PR security scans and findings.
 * No business logic: the service decides dedup, inheritance and status.
 */
import { prisma } from '@/lib/db/prisma'
import {
  activityRepository,
  type CreateActivityData,
} from '@/lib/repositories/activity.repository'
import { storedRepoSpellings } from '@/lib/repositories/repo-spellings'
import { Prisma } from '@prisma/client'
import type {
  ScanStages,
  SecretDowngradeReason,
} from '@/ee/security/security-scan/types'
import { EXTERNAL_ERROR_PREFIX } from '@/ee/security/security-scan/stages'
import type { JudgeBudget } from '@/ee/security/security-scan/judge-budget'
import type { PrSummary } from '@/ee/security/security-scan/pr-summary'
import type { CodeSuggestion } from '@/ee/security/security-scan/code-suggestion'
import {
  mergePartialCauses,
  type PartialCause,
} from '@/shared/src/security-scan'
import type { ReliabilityScanRow } from '@/ee/security/security-scan/reliability'
import {
  isScanFinal,
  redactHuntAuditToCounts,
} from '@/ee/security/security-scan/evidence-retention'

export type ScanStatus = 'PENDING' | 'RUNNING' | 'CLEAN' | 'FINDINGS' | 'FAILED'
export type ScanTrigger = 'PR_EVENT' | 'PR_LINK' | 'SARIF_PUSH'
export type JudgeStatus = 'RAN' | 'UNAVAILABLE' | 'SKIPPED'
export type FindingKind =
  | 'SECRET'
  | 'VULNERABILITY'
  | 'DEPENDENCY'
  // LUM-988: AI-review correctness finding (never blocking).
  | 'CORRECTNESS'
export type FindingSeverity = 'LOW' | 'MEDIUM' | 'HIGH'
export type FindingProvenance = 'DETERMINISTIC' | 'LLM_JUDGE' | 'EXTERNAL_TOOL'
export type FindingDisposition = 'FALSE_POSITIVE' | 'ACCEPTED_RISK'
// LUM-739 — mirror the Prisma enums as string unions (same style as above).
export type FindingReachability = 'EXTERNAL' | 'INTERNAL' | 'UNKNOWN'
export type FalsifierVerdict = 'REJECT' | 'INCONCLUSIVE'
// LUM-740 — what a human did with an LLM-suggested disposition.
export type SuggestionOutcome = 'CONFIRMED' | 'OVERRULED'
/** LUM-988 — the agentic verifier's verdict on an LLM_JUDGE row. */
export type VerifierVerdict = 'CONFIRMED' | 'REJECTED'

export interface NewScanInput {
  pullRequestId: string
  taskId: string | null
  workspaceId: string
  headSha: string
  trigger: ScanTrigger
  detectorVersion: string
}

export interface NewFindingInput {
  scanId: string
  kind: FindingKind
  ruleId: string
  severity: FindingSeverity
  provenance: FindingProvenance
  filePath: string
  line: number | null
  title: string
  detail: string
  evidence: string
  fingerprint: string
  /** EXTERNAL_TOOL only: the rule's `helpUri` from the SARIF the repo's CI pushed. */
  externalRef?: string | null
  disposition?: FindingDisposition | null
  dispositionNote?: string | null
  dispositionedById?: string | null
  dispositionedAt?: Date | null
  inheritedFromFindingId?: string | null
  // LUM-739 (hunt:* rows only). `callChain` is omitted rather than null —
  // Prisma Json columns take `Prisma.JsonNull`, not a JS null.
  cwe?: string | null
  reachability?: FindingReachability | null
  callChain?: Array<{ from: string; to: string }>
  falsifierVerdict?: FalsifierVerdict | null
  /** LUM-738: the fingerprint is on the default branch's security baseline. */
  persisting?: boolean
  /**
   * LUM-758 follow-up (secret: rows only) — why the severity was lowered to
   * LOW. Written straight from the scanner's own `RawSecretFinding.downgrade`;
   * never re-derived from `detail`.
   */
  secretDowngrade?: SecretDowngradeReason | null
  // LUM-740: inherited from an earlier scan of the same PR (same fingerprint).
  suggestedDisposition?: FindingDisposition | null
  suggestedReason?: string | null
  suggestionOutcome?: SuggestionOutcome | null
  /**
   * LUM-1150 (LLM_JUDGE rows only) — the validated one-click fix. Omitted
   * rather than null (Prisma Json columns take `Prisma.JsonNull`). Never
   * carried to a later scan: its line range belongs to this head.
   */
  codeSuggestion?: CodeSuggestion
}

/** LUM-739 — what the hunt workflow writes back onto the scan row. */
export interface PersistHuntResultInput {
  // LUM-758: SKIPPED joins the set — the planner may decide a PR is not worth
  // hunting (empty subgraph, or no category planned), which is a complete
  // layer, not a failed one.
  // LUM-832: PENDING = a batch of an oversized diff landed and the next one
  // is queued — its findings are written, the layer stays in progress.
  hunt: 'RAN' | 'PARTIAL' | 'FAILED' | 'SKIPPED' | 'PENDING'
  huntAudit: Record<string, unknown>
  tokenSpent: number | null
  /** LUM-832 — why the hunt is not whole; empty = it is. */
  partialCauses: PartialCause[]
  /**
   * LUM-822 — which hunt attempt is writing (absent = the first, the one
   * stage A started). A write from an attempt older than the row's
   * `huntAttempts` is dropped: the stale-hunt sweep has already started a
   * newer run, and only that run's result may land.
   */
  attempt?: number
}

export interface FinalizeScanInput {
  /** Manual same-head review replaces stage A rows only when it succeeds. */
  replaceStageAFindings?: boolean
  status: ScanStatus
  judgeStatus: JudgeStatus | null
  truncated: boolean
  /**
   * LUM-814 — the judge's budget arithmetic, or null when this scan never
   * reached the budget step (an empty diff, or a crash before the judge).
   * null is NOT written: it leaves whatever is on the row alone, the same
   * ingest-ownership rule the stages merge follows — a stage-A crash must not
   * erase a number an earlier writer established.
   */
  judgeBudget?: JudgeBudget | null
  /**
   * LUM-849 — the judge's cleaned PR description. Absent/null leaves the
   * column alone, like `judgeBudget` (`restart` is what clears it).
   */
  prSummary?: PrSummary | null
  /**
   * LUM-1127 — the paths an incremental AI review read on this head; null =
   * the whole PR diff. Absent = leave the column alone. The PR write-back
   * only resolves a judge finding's thread for a file inside this scope.
   */
  judgeReviewScope?: string[] | null
  /** LUM-735 — per-layer outcomes; whatever was collected when the scan ended. */
  stages: ScanStages
  /**
   * LUM-832 — why a layer is not whole (was LUM-735's bare `partial`). The
   * row's `partial` is derived from it: no writer can mark a scan incomplete
   * without naming a cause.
   */
  partialCauses: PartialCause[]
  /**
   * LUM-832 — stage A's own note on the hunt, written only when stage A
   * decided the hunt (e.g. `{ overCap }` when the file cap forbade it). Absent
   * = leave the column alone: the hunt workflow owns it otherwise.
   */
  huntAudit?: Record<string, unknown>
  error?: string | null
}

/** LUM-745 — an older scan on the same PR whose managed run may still be going. */
export interface SupersedableScan {
  id: string
  headSha: string
  managedRunId: string
  stages: ScanStages | null
}

/** LUM-822 — a scan whose hunt layer has sat PENDING past the dead window. */
export interface StalePendingHunt {
  id: string
  pullRequestId: string
  startedAt: Date
  /** The HuntJob stage A started with; null on rows from before LUM-822. */
  huntJob: unknown
  huntRunId: string | null
  huntAttempts: number
}

/** LUM-745 — a scan whose external layer has sat PENDING past the dead window. */
export interface StalePendingScan {
  id: string
  managedRunId: string | null
  stages: ScanStages | null
}

export interface FindingRow {
  id: string
  scanId: string
  kind: FindingKind
  ruleId: string
  severity: FindingSeverity
  provenance: FindingProvenance
  filePath: string
  line: number | null
  title: string
  detail: string
  evidence: string
  fingerprint: string
  externalRef: string | null
  disposition: FindingDisposition | null
  dispositionNote: string | null
  dispositionedById: string | null
  dispositionedAt: Date | null
  inheritedFromFindingId: string | null
  // LUM-739 (hunt:* rows only; null elsewhere).
  cwe: string | null
  reachability: FindingReachability | null
  callChain: Array<{ from: string; to: string }> | null
  falsifierVerdict: FalsifierVerdict | null
  // LUM-740 (EXTERNAL_TOOL rows the falsifier REJECTed): a suggestion, never
  // a disposition; `suggestionOutcome` is the human's verdict on it.
  suggestedDisposition: FindingDisposition | null
  suggestedReason: string | null
  suggestionOutcome: SuggestionOutcome | null
  // LUM-988 (LLM_JUDGE rows the agentic verifier checked; null = not verified).
  verifierVerdict: VerifierVerdict | null
  verifierReason: string | null
  /** LUM-738: already on the default-branch baseline — not introduced by this PR. */
  persisting: boolean
  /** LUM-758 follow-up (secret: rows only; null elsewhere and when not downgraded). */
  secretDowngrade: SecretDowngradeReason | null
  createdAt: Date
}

export interface ScanWithFindings {
  id: string
  pullRequestId: string
  taskId: string | null
  workspaceId: string
  headSha: string
  status: ScanStatus
  trigger: ScanTrigger
  judgeStatus: JudgeStatus | null
  truncated: boolean
  /** null on rows written before LUM-735 — the service derives a legacy view. */
  stages: ScanStages | null
  partial: boolean
  detectorVersion: string
  error: string | null
  startedAt: Date
  finishedAt: Date | null
  /** LUM-737: first PreToolUse reminder time; null = not yet reminded. */
  agentNotifiedAt: Date | null
  /** LUM-740: GitHub id of the per-PR summary comment; null until first create. */
  summaryCommentId: string | null
  /** LUM-740: when the suggested-disposition pass finished; null = not yet. */
  suggestedAt: Date | null
  suggestionTokens: number | null
  /** LUM-739's audit Json, raw. LUM-762 reads it via `parseHuntCoverage`. */
  huntAudit: unknown
  /** LUM-822 job Json, raw. LUM-832 reads its batch plan (`huntBatchProgress`). */
  huntJob?: unknown
  /** LUM-832 — why the scan is not whole (text[]; absent on an old mock). */
  partialCauses?: string[]
  /** LUM-814 budget Json, raw. LUM-832 reads the AI review's size cap off it. */
  judgeBudget?: unknown
  /** LUM-911 — when the code fields were scrubbed; null/absent = still held. */
  codeScrubbedAt?: Date | null
  /** LUM-1148 — the pre-merge checks' results Json, raw (absent on an old mock). */
  preMergeChecks?: unknown
  findings: FindingRow[]
}

/**
 * LUM-788 — one finding as the by-PR scan read-out (`lumo pr scan`) loads
 * it. `evidence` is absent by construction, the same P8 rule as
 * `ReviewFindingRow`: the read-out is printed into an agent's terminal, and
 * a column the query never loads is a column no renderer can leak.
 */
export type ReadoutFindingRow = Omit<FindingRow, 'evidence'>

/**
 * LUM-788 — one scan row with everything `lumo pr scan` prints: the layer
 * facts, the findings (without evidence), the raw hunt audit and the token
 * spend. Same columns as `ScanWithFindings` minus the write-path-only ones
 * (`agentNotifiedAt`, `summaryCommentId`, `suggestedAt`, `suggestionTokens`).
 */
export interface ScanReadoutRow {
  id: string
  pullRequestId: string
  workspaceId: string
  headSha: string
  status: ScanStatus
  trigger: ScanTrigger
  judgeStatus: JudgeStatus | null
  truncated: boolean
  stages: ScanStages | null
  partial: boolean
  detectorVersion: string
  error: string | null
  startedAt: Date
  finishedAt: Date | null
  /** null = not metered (team rule: null ≠ 0). */
  tokenSpent: number | null
  huntAudit: unknown
  /** LUM-814's budget Json, raw. The read-out parses it with `parseJudgeBudget`. */
  judgeBudget: unknown
  /** LUM-832 — the causes, and the hunt job (its file-cap count). */
  partialCauses: string[]
  huntJob: unknown
  findings: ReadoutFindingRow[]
}

/**
 * LUM-735 Task 2 — the finding columns the PR write-back renders, and only
 * those. `evidence` is absent by construction: P8's red line stops being a
 * rule the builder has to remember and becomes a column the query never
 * loads. `status` / `taskId` are not here either — the write-back reads
 * `stages` + `partial` for completeness and `task` for the Lumo link (ISP).
 */
export type ReviewFindingRow = Pick<
  FindingRow,
  | 'id'
  | 'kind'
  | 'ruleId'
  | 'severity'
  | 'provenance'
  | 'filePath'
  | 'line'
  | 'title'
  | 'detail'
  | 'fingerprint'
  | 'externalRef'
  | 'disposition'
  | 'persisting'
  | 'suggestedDisposition'
  | 'verifierVerdict'
  | 'verifierReason'
> & {
  /** LUM-1150 — the stored suggestion Json, raw; read with `parseCodeSuggestion`. */
  codeSuggestion?: unknown
}

/**
 * LUM-735 Task 2 — one scan with everything the PR write-back renders: its
 * findings, the PR to comment on, and the task/workspace the "Open in Lumo"
 * link points at.
 */
export interface ScanForReview {
  id: string
  headSha: string
  /** LUM-832: a FAILED stage A must not summarise as checked. */
  status: ScanStatus
  stages: ScanStages | null
  /** LUM-832: the running hunt job, for the batched hunt's covered share. */
  huntJob: unknown
  /** LUM-832: the causes, to tell a size-cap-only scan from an unfinished one. */
  partialCauses?: string[]
  /** LUM-832: where the size-cap facts live (hunt overCap, judge budget). */
  huntAudit: unknown
  judgeBudget: unknown
  /** LUM-849: raw Json — read with `parsePrSummary`. */
  prSummary: unknown
  partial: boolean
  error: string | null
  /** LUM-740: the summary comment this scan (or an earlier one) already owns. */
  summaryCommentId: string | null
  /** LUM-740: null until the suggested-disposition pass ran — external rows wait. */
  suggestedAt: Date | null
  /** LUM-988: the verifier started / finished — LLM_JUDGE inline comments wait between. */
  verifierStartedAt: Date | null
  verifiedAt: Date | null
  /**
   * LUM-1127 — raw Json: the incremental judge's paths, or null for the
   * whole diff. Optional so older fixtures still type-check (absent = null).
   */
  judgeReviewScope?: unknown
  /**
   * LUM-1146 — raw Json: how `.lumo.yaml` was read (`parseRepoConfigNotice`).
   * Optional so older fixtures still type-check (absent = not read).
   */
  repoConfig?: unknown
  /**
   * LUM-1148 — raw Json: the pre-merge checks' results
   * (`parsePreMergeChecksRecord`). Optional so older fixtures still
   * type-check (absent = no check ran).
   */
  preMergeChecks?: unknown
  /** LUM-1147 — the review profile the scan ran with (null/absent = chill). */
  reviewProfile?: string | null
  /**
   * LUM-1151 — where the high-level summary goes for this review
   * (null/absent = the PR description).
   */
  highLevelSummary?: string | null
  findings: ReviewFindingRow[]
  pullRequest: {
    id: string
    repo: string
    headSha?: string | null
    number: number
    /** "open" | "closed" | "merged" (optional: older fixtures omit it). */
    state?: string
    workspaceId: string
    /** LUM-1148 — the per-PR override (absent / null = not overridden). */
    preMergeOverrideBy?: string | null
    preMergeOverrideAt?: Date | null
    preMergeOverrideSha?: string | null
    task: { number: number; team: { identifier: string } } | null
    /** `securityPolicy` is the raw Json column — parse with `parseSecurityPolicy`. */
    workspace: {
      slug: string
      securityPolicy: unknown
      /** LUM-1130 — the request-changes workflow (absent reads as off). */
      securityRequestChangesEnabled?: boolean
    }
  }
}

/**
 * A prior finding on the same PR worth inheriting from: a human disposition
 * and/or (LUM-740) an LLM suggestion with the human's outcome on it.
 *
 * LUM-1128 follow-up: a REOPENED row (a ruling reverted to open in the web
 * panel) is one too — `disposition` null with `dispositionedAt` set to the
 * moment it was reopened. It is the newest verdict for its fingerprint, so
 * it wins the newest-first pick and nothing older re-clears the finding.
 */
export interface DispositionedFingerprint {
  id: string
  fingerprint: string
  disposition: FindingDisposition | null
  dispositionNote: string | null
  dispositionedById: string | null
  dispositionedAt: Date | null
  suggestedDisposition: FindingDisposition | null
  suggestedReason: string | null
  suggestionOutcome: SuggestionOutcome | null
}

/** LUM-988 — one LLM_JUDGE row as the agentic verifier reads it. */
export type JudgeFindingForVerify = Pick<
  FindingRow,
  | 'id'
  | 'kind'
  | 'ruleId'
  | 'severity'
  | 'filePath'
  | 'line'
  | 'title'
  | 'detail'
  | 'evidence'
>

export interface FindingSummary {
  severity: string
  ruleId: string
  title: string
}

/**
 * LUM-735 review — every writer of the shared scan row does read-modify-write
 * on it: the `findUnique` that feeds the merge runs BEFORE the locking
 * `update`, so at READ COMMITTED a writer that commits inside that window (one
 * round trip wide) is merged from a stale snapshot — an ingest misses stage
 * A's CLEAN, stage A reverts `stages.external` from RAN back to PENDING, and a
 * `partial` set by the other side is cleared. SERIALIZABLE closes it: Postgres
 * aborts one of the two with a serialization failure (P2034) instead of
 * committing the lost update, and we simply run the whole transaction again
 * from fresh reads. Retries are safe because every one of these transactions
 * is a pure read-then-write of the same row (no external side effects).
 */
const SERIALIZABLE_TX = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  timeout: 15_000,
} as const

function isSerializationFailure(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2034'
}

async function withSerializableRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  attempts = 3
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(fn, SERIALIZABLE_TX)
    } catch (error) {
      if (attempt >= attempts || !isSerializationFailure(error)) throw error
    }
  }
}

/**
 * LUM-735 — the row is shared by stage A and the SARIF ingest worker: an
 * ingest-owned `stages.external` (RAN or FAILED, i.e. a report has actually
 * landed or the ingest itself blew up) must survive whatever stage A writes
 * over it, and `partial` is monotone across the two writers — once either
 * side has hit a cap it can never be cleared by the other. That monotonicity
 * holds against a concurrent writer only because these transactions run
 * SERIALIZABLE with a P2034 retry (see `withSerializableRetry`). Shared by
 * `persistResult` (the success path) and `finalize` (the FAILED path).
 */
interface PartialColumns {
  partial?: boolean | null
  partialCauses?: string[] | null
}

/**
 * LUM-832 — the causes are a union across writers, and `partial` stays their
 * monotone OR (a pre-LUM-832 `true` with no cause is kept, and reads as
 * unattributed). Same SERIALIZABLE guarantee as the stages merge.
 */
function mergePartial(
  current: PartialColumns | null,
  incoming: ReadonlyArray<PartialCause>
): { partial: boolean; partialCauses: string[] } {
  const partialCauses = mergePartialCauses(current?.partialCauses, incoming)
  return {
    partial: (current?.partial ?? false) || partialCauses.length > 0,
    partialCauses,
  }
}

function mergeIngestOwnedStages(
  current:
    | ({
        stages: unknown
        error?: string | null
      } & PartialColumns)
    | null,
  incoming: { stages: ScanStages; partialCauses: PartialCause[] }
): {
  stages: ScanStages
  partial: boolean
  partialCauses: string[]
  error?: string
} {
  const cur = (current?.stages as ScanStages | null) ?? {}
  const stages: ScanStages = { ...incoming.stages }
  const external = cur.external
  let keptExternal = false
  // LUM-745: SUPERSEDED is stamped by stage A of a NEWER head while this
  // row's own stage A may still be finishing — it owns the layer just like
  // an ingest result does.
  if (
    external === 'RAN' ||
    external === 'FAILED' ||
    external === 'SUPERSEDED'
  ) {
    stages.external = external
    keptExternal = true
  }
  // LUM-738: the managed run also owns `supplyChain` once it has spoken —
  // RAN (rows landed), FAILED, or SKIPPED (nothing to scan is a fact too).
  const supplyChain = cur.supplyChain
  if (
    supplyChain === 'RAN' ||
    supplyChain === 'FAILED' ||
    supplyChain === 'SKIPPED' ||
    supplyChain === 'SUPERSEDED'
  )
    stages.supplyChain = supplyChain
  // LUM-745 (review): the reason that came with a kept external layer — a
  // prefixed, scrubbed string from supersede, the sweep or the run's own
  // failure — travels with it; stage A's finish must not blank it.
  const error =
    keptExternal &&
    typeof current?.error === 'string' &&
    current.error.startsWith(EXTERNAL_ERROR_PREFIX)
      ? current.error
      : undefined
  return {
    stages,
    ...mergePartial(current, incoming.partialCauses),
    ...(error !== undefined ? { error } : {}),
  }
}

/**
 * LUM-740 — one EXTERNAL_TOOL finding the suggested-disposition falsifier may
 * judge. No `evidence` (P8) and `line` is non-null by the query.
 */
export interface SuggestionCandidateRow {
  id: string
  ruleId: string
  severity: FindingSeverity
  filePath: string
  line: number
  title: string
  detail: string
  externalRef: string | null
}

export interface ScanForSuggestion {
  id: string
  pullRequest: { workspaceId: string; repo: string; number: number }
  findings: SuggestionCandidateRow[]
}

/** LUM-737: a FINDINGS scan the agent has not been reminded about yet. */
export interface UnnotifiedFindingScan {
  id: string
  pullRequestId: string
  headSha: string
}

const SCRUB_TX = { timeout: 15_000 } as const
/**
 * LUM-927 — scans scrubbed per transaction. A whole large workspace in one
 * transaction could outlast any timeout (P2028) and fail every day; batches
 * commit one by one, so a failure keeps what was done and a rerun — scrubbing
 * is idempotent — finishes the rest.
 */
export const SCRUB_BATCH_SIZE = 200

/**
 * LUM-855 — clear the customer-code fields of the scans `scanWhere` selects
 * (finding evidence + call chain; the scan's hunt audit, hunt job and PR
 * summary). Rows stay: scan history and dispositions still drive DONE
 * gating.
 *
 * LUM-872 — the finding's LLM-written text can quote code too: `detail` and
 * `suggestedReason` are cleared, and `title` falls back to the finding's
 * `ruleId` so every list still has something to show.
 *
 * LUM-927 — in batches of `SCRUB_BATCH_SIZE` scans, by id, each in its own
 * transaction. A batch that throws fails the call (callers keep the list,
 * so it is retried) with the batches before it already committed.
 */
async function scrubCode(
  scanWhere: Prisma.PrSecurityScanWhereInput,
  huntAudit: HuntAuditScrub = 'drop'
) {
  const counts = { findings: 0, scans: 0 }
  let after: string | null = null
  for (;;) {
    const batch: { id: string }[] = await prisma.prSecurityScan.findMany({
      where: after ? { AND: [scanWhere, { id: { gt: after } }] } : scanWhere,
      orderBy: { id: 'asc' },
      take: SCRUB_BATCH_SIZE,
      select: { id: true },
    })
    if (batch.length === 0) break
    const part = await scrubScans(
      batch.map(scan => scan.id),
      huntAudit
    )
    counts.findings += part.findings
    counts.scans += part.scans
    after = batch[batch.length - 1]!.id
    if (batch.length < SCRUB_BATCH_SIZE) break
  }
  return counts
}

/**
 * LUM-911 — what a scrub does to `huntAudit`: `drop` clears it (the scan's
 * repository left the workspace), `counts` keeps the code-free counts the UI
 * still reads (`redactHuntAuditToCounts`) — a retention scrub of a scan the
 * customer still sees.
 */
type HuntAuditScrub = 'drop' | 'counts'

/** One batch of `scrubCode`, in one transaction. */
async function scrubScans(scanIds: string[], huntAudit: HuntAuditScrub) {
  // LUM-902 — the default 5s is too short for a scan-heavy batch (P2028).
  return prisma.$transaction(async tx => {
    const inBatch = { scanId: { in: scanIds } }
    const rules = await tx.prSecurityFinding.findMany({
      where: inBatch,
      distinct: ['ruleId'],
      select: { ruleId: true },
    })
    for (const { ruleId } of rules) {
      await tx.prSecurityFinding.updateMany({
        where: { ...inBatch, ruleId },
        data: { title: ruleId },
      })
    }
    const findings = await tx.prSecurityFinding.updateMany({
      where: inBatch,
      data: {
        evidence: '',
        callChain: Prisma.DbNull,
        detail: '',
        suggestedReason: null,
        codeSuggestion: Prisma.DbNull,
      },
    })
    // Read before the clear below: the counts are kept from this copy.
    const audits =
      huntAudit === 'counts'
        ? await tx.prSecurityScan.findMany({
            where: { id: { in: scanIds }, huntAudit: { not: Prisma.DbNull } },
            select: { id: true, huntAudit: true },
          })
        : []
    const scans = await tx.prSecurityScan.updateMany({
      where: { id: { in: scanIds } },
      data: {
        huntAudit: Prisma.DbNull,
        huntJob: Prisma.DbNull,
        prSummary: Prisma.DbNull,
        codeScrubbedAt: new Date(),
      },
    })
    for (const { id, huntAudit: raw } of audits) {
      const counts = redactHuntAuditToCounts(raw)
      if (!counts) continue
      await tx.prSecurityScan.update({
        where: { id },
        data: { huntAudit: counts as Prisma.InputJsonValue },
      })
    }
    return { findings: findings.count, scans: scans.count }
  }, SCRUB_TX)
}

/** LUM-911 — a scan as the retention check reads it. */
export interface RetentionCandidate {
  id: string
  workspaceId: string
  pullRequestId: string
  status: ScanStatus
  stages: unknown
  startedAt: Date
  finishedAt: Date | null
  suggestedAt: Date | null
  pullRequest: {
    state: string
    mergedAt: Date | null
    closedAt: Date | null
    updatedAt: Date
  }
}

const RETENTION_SELECT = {
  id: true,
  workspaceId: true,
  pullRequestId: true,
  status: true,
  stages: true,
  startedAt: true,
  finishedAt: true,
  suggestedAt: true,
  pullRequest: {
    select: { state: true, mergedAt: true, closedAt: true, updatedAt: true },
  },
} satisfies Prisma.PrSecurityScanSelect

function toRetentionCandidate(
  row: Prisma.PrSecurityScanGetPayload<{ select: typeof RETENTION_SELECT }>
): RetentionCandidate {
  return { ...row, status: row.status as ScanStatus }
}

export const prSecurityScanRepository = {
  /**
   * LUM-855 — scrub every scan a workspace owns (see `scrubCode`). LUM-872 —
   * `repos` narrows it to the PRs of those repositories (a repo removed from
   * the installation).
   */
  async scrubCodeForWorkspace(workspaceId: string, repos?: string[]) {
    return scrubCode({
      workspaceId,
      ...(repos
        ? {
            pullRequest: {
              repo: { in: await storedRepoSpellings(workspaceId, repos) },
            },
          }
        : {}),
    })
  },

  /**
   * LUM-896 — the same scrub for ONE scan: a scan that wrote its result after
   * its repository left the workspace's confirmed list.
   */
  async scrubCodeForScan(scanId: string) {
    return scrubCode({ id: scanId })
  },

  /**
   * LUM-911 — the retention scrub: the same fields, but the hunt audit keeps
   * its code-free counts (the scan is still shown). Skips scans already
   * scrubbed (a rerun is a no-op) and pre-LUM-911 scans (the backlog task's).
   * LUM-914 — `retentionTracked: false` is that backlog: the operator-run
   * stock script scrubs ONLY pre-LUM-911 scans, the same way.
   */
  async scrubCodeForRetention(
    scanIds: string[],
    opts: { retentionTracked?: boolean } = {}
  ) {
    if (scanIds.length === 0) return { findings: 0, scans: 0 }
    return scrubCode(
      {
        id: { in: scanIds },
        codeScrubbedAt: null,
        retentionTracked: opts.retentionTracked ?? true,
      },
      'counts'
    )
  },

  /**
   * LUM-911 — one page of scans the retention sweep must look at: tracked,
   * not yet scrubbed, terminal, and either past the hard cap, on a merged or
   * closed PR, or in a zero-retention workspace. `isScanEvidenceExpired`
   * makes the exact call; this only narrows.
   */
  async findRetentionCandidates(input: {
    hardCapCutoff: Date
    zeroRetentionWorkspaceIds: string[]
    after: string | null
    take: number
    /** LUM-914: false = the pre-LUM-911 backlog instead (stock script only). */
    retentionTracked?: boolean
  }): Promise<RetentionCandidate[]> {
    const rows = await prisma.prSecurityScan.findMany({
      where: {
        retentionTracked: input.retentionTracked ?? true,
        codeScrubbedAt: null,
        status: { in: ['CLEAN', 'FINDINGS', 'FAILED'] },
        ...(input.after ? { id: { gt: input.after } } : {}),
        OR: [
          { finishedAt: { lt: input.hardCapCutoff } },
          { finishedAt: null, startedAt: { lt: input.hardCapCutoff } },
          { pullRequest: { state: { in: ['merged', 'closed'] } } },
          ...(input.zeroRetentionWorkspaceIds.length > 0
            ? [{ workspaceId: { in: input.zeroRetentionWorkspaceIds } }]
            : []),
        ],
      },
      orderBy: { id: 'asc' },
      take: input.take,
      select: RETENTION_SELECT,
    })
    return rows.map(toRetentionCandidate)
  },

  /**
   * LUM-914 — the pre-LUM-911 backlog's size, for the stock script's before /
   * after line: untracked scans still holding what they wrote.
   */
  async countUntrackedUnscrubbed(): Promise<number> {
    return prisma.prSecurityScan.count({
      where: { retentionTracked: false, codeScrubbedAt: null },
    })
  },

  /** LUM-914 — findings per scan among `scanIds` (the stock dry run's count). */
  async countFindingsByScan(scanIds: string[]): Promise<Map<string, number>> {
    if (scanIds.length === 0) return new Map()
    const rows = await prisma.prSecurityFinding.groupBy({
      by: ['scanId'],
      where: { scanId: { in: scanIds } },
      _count: { _all: true },
    })
    return new Map(rows.map(r => [r.scanId, r._count._all]))
  },

  /** LUM-911 — one scan as the retention check reads it; null when gone. */
  async findRetentionCandidate(
    scanId: string
  ): Promise<RetentionCandidate | null> {
    const row = await prisma.prSecurityScan.findUnique({
      where: { id: scanId },
      select: RETENTION_SELECT,
    })
    return row ? toRetentionCandidate(row) : null
  },

  /**
   * LUM-911 — the PRs among `pullRequestIds` with a scan that is not final
   * yet (still running, or a layer — a hunt — still pending).
   */
  async findPullRequestsWithUnfinishedScans(
    pullRequestIds: string[]
  ): Promise<Set<string>> {
    if (pullRequestIds.length === 0) return new Set()
    const rows = await prisma.prSecurityScan.findMany({
      where: { pullRequestId: { in: pullRequestIds } },
      select: { pullRequestId: true, status: true, stages: true },
    })
    return new Set(
      rows.filter(row => !isScanFinal(row)).map(row => row.pullRequestId)
    )
  },

  /**
   * LUM-902 — every (workspace, repository) whose scans still hold code that
   * `scrubCode` would clear. The backstop sweep compares these with the
   * confirmed lists; scrubbed scans drop out, so the set shrinks to the
   * repositories workspaces actually have confirmed.
   */
  async findRepositoriesHoldingCode(): Promise<
    { workspaceId: string; repo: string }[]
  > {
    const rows = await prisma.pullRequest.groupBy({
      by: ['workspaceId', 'repo'],
      where: {
        securityScans: {
          some: {
            OR: [
              { huntAudit: { not: Prisma.DbNull } },
              { huntJob: { not: Prisma.DbNull } },
              { prSummary: { not: Prisma.DbNull } },
              {
                findings: {
                  some: {
                    OR: [
                      { evidence: { not: '' } },
                      { detail: { not: '' } },
                      { callChain: { not: Prisma.DbNull } },
                      { suggestedReason: { not: null } },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    })
    return rows.map(row => ({ workspaceId: row.workspaceId, repo: row.repo }))
  },

  /** LUM-896 — the workspace and repository a scan belongs to. */
  async findScanRepository(
    scanId: string
  ): Promise<{ workspaceId: string; repo: string } | null> {
    const row = await prisma.prSecurityScan.findUnique({
      where: { id: scanId },
      select: { workspaceId: true, pullRequest: { select: { repo: true } } },
    })
    return row
      ? { workspaceId: row.workspaceId, repo: row.pullRequest.repo }
      : null
  },

  /** `startedAt` rides along so the service can age out a wedged RUNNING scan. */
  async findByPrAndSha(
    pullRequestId: string,
    headSha: string
  ): Promise<{ id: string; status: ScanStatus; startedAt: Date } | null> {
    const row = await prisma.prSecurityScan.findUnique({
      where: { pullRequestId_headSha: { pullRequestId, headSha } },
      select: { id: true, status: true, startedAt: true },
    })
    return row as { id: string; status: ScanStatus; startedAt: Date } | null
  },

  async create(input: NewScanInput): Promise<{ id: string }> {
    return prisma.prSecurityScan.create({
      data: { ...input, status: 'RUNNING' },
      select: { id: true },
    })
  },

  /**
   * LUM-735 — the scan row is shared by the webhook-driven stage A and the CI
   * SARIF push; whoever arrives first creates it. A unique-constraint loss is
   * the other writer winning, not a failure.
   */
  async createIfAbsent(
    input: NewScanInput & { status: 'RUNNING' | 'PENDING' }
  ): Promise<{
    id: string
    created: boolean
    status: ScanStatus
    startedAt: Date
  }> {
    try {
      const row = await prisma.prSecurityScan.create({
        data: input,
        select: { id: true, status: true, startedAt: true },
      })
      return {
        id: row.id,
        status: row.status as ScanStatus,
        startedAt: row.startedAt,
        created: true,
      }
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error
      const existing = await this.findByPrAndSha(
        input.pullRequestId,
        input.headSha
      )
      if (!existing) throw error
      return { ...existing, created: false }
    }
  },

  /** A PENDING row (created by a SARIF push) is claimed by stage A; findings untouched. */
  async claimPending(id: string): Promise<boolean> {
    const result = await prisma.prSecurityScan.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'RUNNING', startedAt: new Date(), error: null },
    })
    return result.count === 1
  },

  /**
   * A FAILED scan is re-run in place. Only stage A's own rows go — EXTERNAL_TOOL
   * findings and the ingest-owned `stages.external` were written by the SARIF
   * push and are not stage A's to discard (LUM-735).
   */
  async restart(
    id: string,
    manual = false,
    expectedStartedAt?: Date
  ): Promise<
    boolean | Awaited<ReturnType<typeof prisma.prSecurityFinding.findMany>>
  > {
    return withSerializableRetry(async tx => {
      const current = await tx.prSecurityScan.findUnique({
        where: { id },
        select: {
          stages: true,
          status: true,
          startedAt: true,
          verifierStartedAt: true,
          verifiedAt: true,
        },
      })
      if (
        expectedStartedAt &&
        current?.startedAt &&
        current.startedAt.getTime() !== expectedStartedAt.getTime()
      )
        return false
      if (
        manual &&
        (!current ||
          !['CLEAN', 'FINDINGS', 'FAILED'].includes(current.status) ||
          Object.values((current.stages as ScanStages | null) ?? {}).includes(
            'PENDING'
          ) ||
          (current.verifierStartedAt && !current.verifiedAt))
      )
        return false
      const external = (current?.stages as ScanStages | null)?.external
      // Snapshot human rulings under the same serializable lock as the
      // restart. A concurrent disposition forces a retry with fresh data.
      const snapshot = manual
        ? await tx.prSecurityFinding.findMany({
            where: { scanId: id, provenance: 'LLM_JUDGE' },
          })
        : null
      if (!manual)
        await tx.prSecurityFinding.deleteMany({
          where: { scanId: id, provenance: { not: 'EXTERNAL_TOOL' } },
        })
      await tx.prSecurityScan.update({
        where: { id },
        data: {
          status: 'RUNNING',
          judgeStatus: null,
          truncated: false,
          // LUM-849: the re-run's judge writes its own description.
          prSummary: Prisma.DbNull,
          // LUM-745: a superseded layer carries no result and no rows —
          // preserving it would leave the re-run permanently "superseded".
          stages:
            external && external !== 'SUPERSEDED'
              ? { external }
              : Prisma.DbNull,
          partial: false,
          partialCauses: [],
          error: null,
          startedAt: new Date(),
          finishedAt: null,
          verifierStartedAt: null,
          verifiedAt: null,
          huntJob: Prisma.DbNull,
          huntAudit: Prisma.DbNull,
          huntRunId: null,
          huntAttempts: 0,
        },
      })
      return snapshot ?? true
    })
  },

  /**
   * The FAILED path — nothing to write but the scan row itself. Same
   * ingest-ownership rule as `persistResult` (LUM-735 review): a crash in
   * stage A must not stomp an `external` the SARIF push already landed, nor
   * clear a `partial` the other writer already set.
   */
  async finalize(id: string, input: FinalizeScanInput): Promise<void> {
    await withSerializableRetry(async tx => {
      const current = await tx.prSecurityScan.findUnique({
        where: { id },
        select: {
          stages: true,
          partial: true,
          partialCauses: true,
          error: true,
        },
      })
      const {
        stages,
        partial,
        partialCauses,
        error: keptError,
      } = mergeIngestOwnedStages(current, input)
      await tx.prSecurityScan.update({
        where: { id },
        data: {
          status: input.status,
          judgeStatus: input.judgeStatus,
          truncated: input.truncated,
          ...(input.judgeBudget
            ? {
                judgeBudget:
                  input.judgeBudget as unknown as Prisma.InputJsonValue,
              }
            : {}),
          stages,
          partial,
          partialCauses,
          error: input.error ?? keptError ?? null,
          finishedAt: new Date(),
        },
      })
    })
  },

  async createFindings(inputs: NewFindingInput[]): Promise<void> {
    if (inputs.length === 0) return
    await prisma.prSecurityFinding.createMany({ data: inputs })
  },

  /**
   * Spec §6.1 — the successful end of a scan is ONE write: the findings and
   * the status that describes them land together or not at all. Split across
   * two round trips, a crash between them leaves either a FINDINGS scan with
   * no rows (a panel claiming problems it cannot show) or rows under a scan
   * still RUNNING (invisible findings that never block Done).
   * `finalize` stays exported for the FAILED path, which has nothing to write.
   *
   * LUM-735 review C1/C2 — lock ordering: the scan-row UPDATE goes FIRST, so
   * this writer and `ingestExternalFindings` both serialize on the same row
   * lock in the same order (no lock-ordering deadlock between them). That is
   * belt to the SERIALIZABLE braces: the isolation level is what actually
   * makes the pre-lock read of `stages`/`partial` safe.
   */
  async persistResult(
    scanId: string,
    findings: NewFindingInput[],
    final: FinalizeScanInput
  ): Promise<void> {
    await withSerializableRetry(async tx => {
      const current = await tx.prSecurityScan.findUnique({
        where: { id: scanId },
        select: {
          stages: true,
          partial: true,
          partialCauses: true,
          error: true,
        },
      })
      const {
        stages,
        partial,
        partialCauses,
        error: keptError,
      } = mergeIngestOwnedStages(current, final)
      await tx.prSecurityScan.update({
        where: { id: scanId },
        data: {
          status: final.status,
          judgeStatus: final.judgeStatus,
          truncated: final.truncated,
          ...(final.judgeBudget
            ? {
                judgeBudget:
                  final.judgeBudget as unknown as Prisma.InputJsonValue,
              }
            : {}),
          ...(final.prSummary
            ? {
                prSummary: final.prSummary as unknown as Prisma.InputJsonValue,
              }
            : {}),
          ...(final.judgeReviewScope !== undefined
            ? {
                judgeReviewScope:
                  final.judgeReviewScope === null
                    ? Prisma.DbNull
                    : (final.judgeReviewScope as Prisma.InputJsonValue),
              }
            : {}),
          stages,
          partial,
          partialCauses,
          ...(final.huntAudit
            ? { huntAudit: final.huntAudit as Prisma.InputJsonValue }
            : {}),
          error: final.error ?? keptError ?? null,
          finishedAt: new Date(),
        },
      })
      if (final.replaceStageAFindings)
        await tx.prSecurityFinding.deleteMany({
          where: { scanId, provenance: { not: 'EXTERNAL_TOOL' } },
        })
      if (findings.length > 0)
        await tx.prSecurityFinding.createMany({ data: findings })
      // LUM-735 review C2 — stage A decided `final.status` from an external
      // count taken seconds ago, before the LLM judge ran and outside this
      // transaction. An ingest that committed in that window would be erased
      // by a blind CLEAN: rows visible in the panel under a scan that says
      // "clean". Now that the row lock is held, the count is authoritative.
      const externalCount = await tx.prSecurityFinding.count({
        where: { scanId, provenance: 'EXTERNAL_TOOL' },
      })
      if (final.status === 'CLEAN' && externalCount > 0) {
        await tx.prSecurityScan.update({
          where: { id: scanId },
          data: { status: 'FINDINGS' },
        })
      }
    })
  },

  /**
   * LUM-735 review C1 — the ingest's whole write, in ONE transaction.
   *
   * Both completion paths (the blob store's `onUploadCompleted` webhook and
   * CI's `/complete` call) dispatch the same job within milliseconds, so two
   * worker invocations run concurrently on the same scan row. At READ
   * COMMITTED, a delete-then-insert pair without a shared lock interleaves:
   * ingest B's `deleteMany` can land between A's delete and A's insert, and
   * B then inserts its own rows while A's are still uncommitted — A's rows
   * survive the delete and both pushes' rows end up in the table.
   *
   * The scan-row UPDATE (step 2) is the serialization primitive: it takes a
   * Postgres row lock held until commit, so a concurrent ingest blocks there
   * until this transaction finishes and then re-reads a settled world. That
   * is why the UPDATE comes BEFORE the finding writes, not after — and why
   * `persistResult` (the other writer of this row) updates first too. The
   * `status`/`stages`/`partial` read in step 1 happens BEFORE that lock, so
   * the row lock alone is not enough: the transaction runs SERIALIZABLE and
   * is retried on P2034 (`withSerializableRetry`), which is what makes the
   * CLEAN→FINDINGS flip and the monotone `partial` correct under concurrency.
   *
   * Steps: read → UPDATE scan (lock) → delete this push's tools' rows →
   * insert → flip a finalized CLEAN to FINDINGS if rows landed.
   *
   * A single SARIF document can carry multiple runs (e.g. semgrep + a
   * secondary ruleset) each prefixing `ruleId` with its own tool slug — so
   * every run's tool must be named in `tools`, or rows from runs other than
   * the first accumulate across pushes instead of being replaced. `tools` is
   * deduped; an empty list is a caller bug and deletes nothing.
   */
  async ingestExternalFindings(
    scanId: string,
    tools: string[],
    rows: NewFindingInput[],
    opts: {
      partialCauses: PartialCause[]
      stage?: 'external' | 'supplyChain'
    }
  ): Promise<{ written: number; flippedToFindings: boolean }> {
    const uniqueTools = Array.from(new Set(tools))
    // LUM-738: osv-scanner's rows land under `supplyChain`; everything else
    // (semgrep, gitleaks, BYO SARIF) is the `external` layer.
    const stage = opts.stage ?? 'external'
    return withSerializableRetry(async tx => {
      const current = await tx.prSecurityScan.findUnique({
        where: { id: scanId },
        select: {
          status: true,
          stages: true,
          partial: true,
          partialCauses: true,
        },
      })
      // The lock. `partial` is monotone across writers — a `false` here can
      // never clear a `true` the other writer already set (guaranteed by the
      // SERIALIZABLE isolation + P2034 retry this runs under, since the read
      // above precedes the lock).
      await tx.prSecurityScan.update({
        where: { id: scanId },
        data: {
          stages: {
            ...((current?.stages as ScanStages | null) ?? {}),
            [stage]: 'RAN',
          },
          ...mergePartial(current, opts.partialCauses),
        },
      })
      if (uniqueTools.length > 0) {
        await tx.prSecurityFinding.deleteMany({
          where: {
            scanId,
            provenance: 'EXTERNAL_TOOL',
            OR: uniqueTools.map(t => ({ ruleId: { startsWith: `ext:${t}:` } })),
          },
        })
      }
      let written = 0
      if (rows.length > 0) {
        const res = await tx.prSecurityFinding.createMany({ data: rows })
        written = res.count
      }
      // A scan stage A already finalized as CLEAN now has findings: say so.
      let flippedToFindings = false
      if (current?.status === 'CLEAN' && rows.length > 0) {
        await tx.prSecurityScan.update({
          where: { id: scanId },
          data: { status: 'FINDINGS' },
        })
        flippedToFindings = true
      }
      return { written, flippedToFindings }
    })
  },

  /** Read-modify-write of the per-layer JSON; the ingest path's only write to the scan row. */
  async mergeStages(
    scanId: string,
    patch: ScanStages,
    extra: {
      partialCauses?: PartialCause[]
      status?: 'FINDINGS'
      error?: string
    } = {}
  ): Promise<void> {
    await withSerializableRetry(async tx => {
      const current = await tx.prSecurityScan.findUnique({
        where: { id: scanId },
        select: { stages: true, partial: true, partialCauses: true },
      })
      const stages = {
        ...((current?.stages as ScanStages | null) ?? {}),
        ...patch,
      }
      await tx.prSecurityScan.update({
        where: { id: scanId },
        data: {
          stages,
          // LUM-735: `partial` is monotone across writers — a `false` from
          // this call can never clear a `true` set by the other writer
          // (SERIALIZABLE + P2034 retry; the read above precedes the lock).
          ...(extra.partialCauses !== undefined
            ? mergePartial(current, extra.partialCauses)
            : {}),
          ...(extra.status ? { status: extra.status } : {}),
          // LUM-735 Task 1: the caller (markExternalFailed) already scrubbed,
          // prefixed and capped this string — a missing reason writes no
          // `error` at all rather than clearing an existing one.
          ...(extra.error !== undefined ? { error: extra.error } : {}),
        },
      })
    })
  },

  /**
   * LUM-739 — the hunt workflow's ONE write to the scan row plus its findings,
   * in one transaction (same shape and lock order as `persistResult` /
   * `mergeStages`: scan UPDATE first, then the rows). `stages.hunt` is
   * merged, never replaced; `partial` stays monotone; `status` flips to
   * FINDINGS only when rows land (a FAILED hunt writes no rows and changes no
   * status). `huntAudit` / `tokenSpent` are overwritten — the run owns them.
   */
  async persistHuntResult(
    scanId: string,
    findings: NewFindingInput[],
    final: PersistHuntResultInput
  ): Promise<boolean> {
    return withSerializableRetry(async tx => {
      const current = await tx.prSecurityScan.findUnique({
        where: { id: scanId },
        select: {
          stages: true,
          partial: true,
          partialCauses: true,
          huntAttempts: true,
          tokenSpent: true,
        },
      })
      // LUM-822: a superseded attempt's late write changes nothing.
      if ((current?.huntAttempts ?? 0) > (final.attempt ?? 1)) return false
      // LUM-832: a retry adds its spend to what the faulted attempt left on
      // the row (see `claimHuntRetry`); the first attempt owns the column.
      const tokenSpent =
        (final.attempt ?? 1) > 1 &&
        typeof current?.tokenSpent === 'number' &&
        final.tokenSpent !== null
          ? current.tokenSpent + final.tokenSpent
          : final.tokenSpent
      const stages: ScanStages = {
        ...((current?.stages as ScanStages | null) ?? {}),
        hunt: final.hunt,
      }
      await tx.prSecurityScan.update({
        where: { id: scanId },
        data: {
          stages,
          ...mergePartial(current, final.partialCauses),
          huntAudit: final.huntAudit as Prisma.InputJsonValue,
          tokenSpent,
          ...(findings.length > 0 ? { status: 'FINDINGS' } : {}),
        },
      })
      // LUM-832: a retry of a batch can resubmit what an earlier run of this
      // scan already landed — nothing on the table makes a fingerprint unique, so
      // drop the ones already on the scan. The first run has nothing to meet.
      let rows = findings
      if ((final.attempt ?? 1) > 1 && findings.length > 0) {
        const landed = await tx.prSecurityFinding.findMany({
          where: {
            scanId,
            fingerprint: { in: findings.map(f => f.fingerprint) },
          },
          select: { fingerprint: true },
        })
        const seen = new Set(landed.map(f => f.fingerprint))
        rows = findings.filter(f => {
          if (seen.has(f.fingerprint)) return false
          seen.add(f.fingerprint)
          return true
        })
      }
      if (rows.length > 0) await tx.prSecurityFinding.createMany({ data: rows })
      return true
    })
  },

  /**
   * LUM-822 — the hunt stage A just started: keep its job (the retry input),
   * its run id and the start time the stale-hunt sweep measures from.
   */
  async recordHuntStart(
    scanId: string,
    input: { job: Record<string, unknown>; runId: string; attempt: number }
  ): Promise<void> {
    await prisma.prSecurityScan.update({
      where: { id: scanId },
      data: {
        huntJob: input.job as Prisma.InputJsonValue,
        huntRunId: input.runId,
        huntAttempts: input.attempt,
        huntStartedAt: new Date(),
      },
    })
  },

  /**
   * LUM-822 — hunts still PENDING whose latest attempt began before `before`
   * (rows without `huntStartedAt` — from before LUM-822 — fall back to the
   * scan's own start), oldest first.
   */
  async findStalePendingHunts(
    before: Date,
    limit: number
  ): Promise<StalePendingHunt[]> {
    const rows = await prisma.prSecurityScan.findMany({
      where: {
        stages: { path: ['hunt'], equals: 'PENDING' },
        OR: [
          { huntStartedAt: { lt: before } },
          { huntStartedAt: null, startedAt: { lt: before } },
        ],
      },
      orderBy: { startedAt: 'asc' },
      take: limit,
      select: {
        id: true,
        pullRequestId: true,
        startedAt: true,
        huntJob: true,
        huntRunId: true,
        huntAttempts: true,
      },
    })
    return rows as StalePendingHunt[]
  },

  /**
   * LUM-832 — the rows the internal reliability read-out aggregates: every
   * scan started in [since, until), across workspaces (an ops number, never
   * shown to a customer). Only the columns `summarizeScanReliability` reads.
   */
  async findForReliability(
    since: Date,
    until: Date
  ): Promise<ReliabilityScanRow[]> {
    const rows = await prisma.prSecurityScan.findMany({
      where: { startedAt: { gte: since, lt: until } },
      select: {
        status: true,
        stages: true,
        partial: true,
        partialCauses: true,
        huntAudit: true,
      },
    })
    return rows.map(r => ({
      status: r.status,
      stages: (r.stages as ScanStages | null) ?? null,
      partial: r.partial,
      partialCauses: r.partialCauses ?? [],
      huntAudit: r.huntAudit,
    }))
  },

  /** LUM-822 — has the PR been scanned at a newer head since this row? */
  async hasNewerScan(pullRequestId: string, startedAt: Date): Promise<boolean> {
    const newer = await prisma.prSecurityScan.count({
      where: { pullRequestId, startedAt: { gt: startedAt } },
    })
    return newer > 0
  },

  /**
   * LUM-822 — claim the one retry: bump `huntAttempts` from `fromAttempt`,
   * but only while the hunt is still PENDING at that attempt. A compare-and-
   * set, so two overlapping sweep ticks cannot both start a run, and a hunt
   * that landed after the stale read is left alone. From this write on, the
   * older attempt's late result is dropped by `persistHuntResult`.
   */
  async claimHuntRetry(
    scanId: string,
    fromAttempt: number,
    opts: {
      /** LUM-832: the faulted attempt's audit and spend, handed to the row. */
      faulted?: { huntAudit: Record<string, unknown>; tokenSpent: number }
      /**
       * LUM-832: the job the claimed attempt runs with — a retry's `tries`,
       * a continuation's next batch — so the stale sweep, which retries from
       * `huntJob`, redoes the right batch and counts the right tries.
       */
      huntJob?: Record<string, unknown>
    } = {}
  ): Promise<boolean> {
    const { faulted, huntJob } = opts
    const { count } = await prisma.prSecurityScan.updateMany({
      where: {
        id: scanId,
        huntAttempts: fromAttempt,
        stages: { path: ['hunt'], equals: 'PENDING' },
      },
      data: {
        huntAttempts: fromAttempt + 1,
        huntStartedAt: new Date(),
        huntRunId: null,
        // LUM-832: an attempt that ended on our fault hands its audit and
        // its spend to the row as it re-queues, so the retry's result can
        // add to the spend rather than erase it (null ≠ 0 either way).
        ...(faulted
          ? {
              huntAudit: faulted.huntAudit as Prisma.InputJsonValue,
              tokenSpent: faulted.tokenSpent,
            }
          : {}),
        ...(huntJob ? { huntJob: huntJob as Prisma.InputJsonValue } : {}),
      },
    })
    return count === 1
  },

  /**
   * LUM-832 — has this scan's PR been scanned at a newer head since? The
   * in-run re-queue asks it by scan id (the run has no `startedAt`).
   */
  async hasNewerScanThan(scanId: string): Promise<boolean> {
    const row = await prisma.prSecurityScan.findUnique({
      where: { id: scanId },
      select: { pullRequestId: true, startedAt: true },
    })
    if (!row) return false
    return this.hasNewerScan(row.pullRequestId, row.startedAt)
  },

  async setHuntRunId(scanId: string, runId: string): Promise<void> {
    await prisma.prSecurityScan.update({
      where: { id: scanId },
      data: { huntRunId: runId },
    })
  },

  /**
   * LUM-822 — stamp a stale hunt FAILED, only if it is still PENDING at the
   * attempt the sweep read (a result that landed in between wins). The reason
   * goes in `huntAudit`, like every hunt failure; `tokenSpent` is left alone
   * (null ≠ 0 — the dead run's spend is simply unknown).
   */
  async failStaleHunt(
    scanId: string,
    atAttempt: number,
    reason: string
  ): Promise<boolean> {
    return this.settlePendingHunt(scanId, atAttempt, reason, 'FAILED')
  },

  /**
   * LUM-901 — the same CAS as `failStaleHunt`, but the customer turned the
   * hunt (or the whole scan) off while it was running: the layer reads as
   * turned off in settings, never as unfinished on our side.
   */
  async disableStaleHunt(
    scanId: string,
    atAttempt: number,
    reason: string
  ): Promise<boolean> {
    return this.settlePendingHunt(scanId, atAttempt, reason, 'DISABLED')
  },

  async settlePendingHunt(
    scanId: string,
    atAttempt: number,
    reason: string,
    hunt: 'FAILED' | 'DISABLED'
  ): Promise<boolean> {
    return withSerializableRetry(async tx => {
      const current = await tx.prSecurityScan.findUnique({
        where: { id: scanId },
        select: { stages: true, huntAttempts: true },
      })
      const stages = (current?.stages as ScanStages | null) ?? {}
      if (stages.hunt !== 'PENDING' || current?.huntAttempts !== atAttempt)
        return false
      await tx.prSecurityScan.update({
        where: { id: scanId },
        data: {
          stages: { ...stages, hunt },
          huntAudit: { error: reason.slice(0, 500) },
        },
      })
      return true
    })
  },

  async countExternalFindings(scanId: string): Promise<number> {
    return prisma.prSecurityFinding.count({
      where: { scanId, provenance: 'EXTERNAL_TOOL' },
    })
  },

  /**
   * LUM-758 — 规划步要的 stage A finding 摘要。刻意不复用
   * `findByIdForReview`：那个方法为了 PR 同步 join 了 pullRequest /
   * workspace，规划步一个都用不上。
   */
  async findFindingSummaryByScan(scanId: string): Promise<FindingSummary[]> {
    const rows = await prisma.prSecurityFinding.findMany({
      where: { scanId },
      orderBy: { createdAt: 'asc' },
      select: { severity: true, ruleId: true, title: true },
      take: 50,
    })
    return rows as FindingSummary[]
  },

  /**
   * LUM-735 Task 2 — the scan as the PR write-back needs it, and nothing more
   * (ISP). Read-only projection; every decision (which findings get a comment,
   * what the summary says) belongs to `securityPrReviewService`.
   *
   * P8: the finding `select` deliberately omits `evidence`, so the review path
   * cannot leak a column it never reads. `orderBy` on `createdAt` does not
   * require selecting it.
   */
  async findByIdForReview(scanId: string): Promise<ScanForReview | null> {
    const row = await prisma.prSecurityScan.findUnique({
      where: { id: scanId },
      select: {
        id: true,
        headSha: true,
        status: true,
        stages: true,
        huntJob: true,
        partialCauses: true,
        huntAudit: true,
        judgeBudget: true,
        prSummary: true,
        partial: true,
        error: true,
        summaryCommentId: true,
        suggestedAt: true,
        verifierStartedAt: true,
        verifiedAt: true,
        judgeReviewScope: true,
        repoConfig: true,
        preMergeChecks: true,
        reviewProfile: true,
        highLevelSummary: true,
        findings: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            kind: true,
            ruleId: true,
            severity: true,
            provenance: true,
            filePath: true,
            line: true,
            title: true,
            detail: true,
            fingerprint: true,
            externalRef: true,
            disposition: true,
            persisting: true,
            suggestedDisposition: true,
            verifierVerdict: true,
            verifierReason: true,
            codeSuggestion: true,
          },
        },
        pullRequest: {
          select: {
            id: true,
            repo: true,
            headSha: true,
            number: true,
            // LUM-1140: the off-mode withdrawal only touches an open PR.
            state: true,
            workspaceId: true,
            // LUM-1148: the per-PR override of the pre-merge checks.
            preMergeOverrideBy: true,
            preMergeOverrideAt: true,
            preMergeOverrideSha: true,
            task: {
              select: { number: true, team: { select: { identifier: true } } },
            },
            workspace: {
              select: {
                slug: true,
                securityPolicy: true,
                securityRequestChangesEnabled: true,
              },
            },
          },
        },
      },
    })
    return row as unknown as ScanForReview | null
  },

  async findDispositionedByPullRequest(
    pullRequestId: string
  ): Promise<DispositionedFingerprint[]> {
    // LUM-740: an open LLM suggestion carries over too, so a re-ingest of the
    // same sha neither re-judges nor loses the human's outcome.
    const rows = await prisma.prSecurityFinding.findMany({
      where: {
        scan: { pullRequestId },
        OR: [
          { disposition: { not: null } },
          { suggestedDisposition: { not: null } },
          // LUM-1128 follow-up: the reopen marker (disposition null,
          // dispositionedAt set) — without it an older ruled row of the same
          // fingerprint is inherited and silently re-clears the reopened one.
          { dispositionedAt: { not: null } },
        ],
      },
      orderBy: { dispositionedAt: { sort: 'desc', nulls: 'last' } },
      select: {
        id: true,
        fingerprint: true,
        disposition: true,
        dispositionNote: true,
        dispositionedById: true,
        dispositionedAt: true,
        suggestedDisposition: true,
        suggestedReason: true,
        suggestionOutcome: true,
      },
    })
    return rows as DispositionedFingerprint[]
  },

  /**
   * The newest scan per PR, findings included — at most one row per id.
   * `distinct` on top of `orderBy: startedAt desc` keeps the first (newest)
   * row of each `pullRequestId` group; without it this read every scan ever
   * made for a long-lived PR, hydrating each one's findings (review I5).
   */
  async findLatestByPullRequestIds(ids: string[]): Promise<ScanWithFindings[]> {
    if (ids.length === 0) return []
    const rows = await prisma.prSecurityScan.findMany({
      where: { pullRequestId: { in: ids } },
      orderBy: { startedAt: 'desc' },
      distinct: ['pullRequestId'],
      include: { findings: { orderBy: { createdAt: 'asc' } } },
    })
    return rows as unknown as ScanWithFindings[]
  },

  /**
   * LUM-788 — a PR's scans newest-first (one row per pushed head), each with
   * its findings minus `evidence`. `take` = null reads the whole history
   * (`lumo pr scan --all`); the default read passes 1 for the latest head.
   */
  async listByPullRequest(
    pullRequestId: string,
    take: number | null
  ): Promise<ScanReadoutRow[]> {
    const rows = await prisma.prSecurityScan.findMany({
      where: { pullRequestId },
      orderBy: { startedAt: 'desc' },
      ...(take === null ? {} : { take }),
      select: {
        id: true,
        pullRequestId: true,
        workspaceId: true,
        headSha: true,
        status: true,
        trigger: true,
        judgeStatus: true,
        truncated: true,
        stages: true,
        partial: true,
        detectorVersion: true,
        error: true,
        startedAt: true,
        finishedAt: true,
        tokenSpent: true,
        huntAudit: true,
        judgeBudget: true,
        partialCauses: true,
        huntJob: true,
        findings: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            scanId: true,
            kind: true,
            ruleId: true,
            severity: true,
            provenance: true,
            filePath: true,
            line: true,
            title: true,
            detail: true,
            fingerprint: true,
            externalRef: true,
            disposition: true,
            dispositionNote: true,
            dispositionedById: true,
            dispositionedAt: true,
            inheritedFromFindingId: true,
            cwe: true,
            reachability: true,
            callChain: true,
            falsifierVerdict: true,
            suggestedDisposition: true,
            suggestedReason: true,
            suggestionOutcome: true,
            verifierVerdict: true,
            verifierReason: true,
            persisting: true,
            secretDowngrade: true,
            createdAt: true,
          },
        },
      },
    })
    return rows as unknown as ScanReadoutRow[]
  },

  /**
   * FINDINGS scans on a task the agent has NOT yet been reminded about
   * (LUM-737). Drives the one-shot PreToolUse reminder: keyed on the scan's
   * denormalised `taskId` (indexed) and `agentNotifiedAt: null`, so the hot
   * path is one cheap query that returns nothing once every scan is stamped.
   * Minimal projection — the service re-reads the latest scans (with findings)
   * only when this is non-empty.
   */
  async findUnnotifiedFindingScansByTask(
    taskId: string
  ): Promise<UnnotifiedFindingScan[]> {
    return prisma.prSecurityScan.findMany({
      where: { taskId, status: 'FINDINGS', agentNotifiedAt: null },
      select: { id: true, pullRequestId: true, headSha: true },
      orderBy: { startedAt: 'asc' },
    })
  },

  /**
   * Stamp `agentNotifiedAt` on scans that haven't been reminded yet
   * (LUM-737). Guarded by `agentNotifiedAt: null` so it is idempotent — a
   * second call touches nothing and the reminder never re-fires. Returns how
   * many rows were freshly stamped.
   */
  async markAgentNotified(scanIds: string[], now: Date): Promise<number> {
    if (scanIds.length === 0) return 0
    const { count } = await prisma.prSecurityScan.updateMany({
      where: { id: { in: scanIds }, agentNotifiedAt: null },
      data: { agentNotifiedAt: now },
    })
    return count
  },

  async findFindingWithScope(findingId: string): Promise<
    | (FindingRow & {
        scan: {
          pullRequestId: string
          pullRequest: { taskId: string | null; workspaceId: string }
        }
      })
    | null
  > {
    const row = await prisma.prSecurityFinding.findUnique({
      where: { id: findingId },
      include: {
        scan: {
          select: {
            pullRequestId: true,
            pullRequest: { select: { taskId: true, workspaceId: true } },
          },
        },
      },
    })
    return row as unknown as
      | (FindingRow & {
          scan: {
            pullRequestId: string
            pullRequest: { taskId: string | null; workspaceId: string }
          }
        })
      | null
  },

  /**
   * Write a ruling and its task-timeline entry in ONE transaction (LUM-1128
   * follow-up). `from` — the disposition before this write — is read inside
   * the transaction, and `activityFor(from)` builds the timeline entry (null
   * = none, e.g. a re-save of the same value). If the activity insert fails
   * the ruling rolls back with it, so a caller never reports "rejected" for
   * a ruling that was in fact applied. `disposition: null` reopens the
   * finding (the web panel's revert).
   */
  async updateDisposition(
    findingId: string,
    data: {
      disposition: FindingDisposition | null
      dispositionNote: string | null
      dispositionedById: string
      dispositionedAt: Date
      /** LUM-740: the human's verdict on a suggested disposition, if any. */
      suggestionOutcome?: SuggestionOutcome | null
    },
    activityFor: (
      from: FindingDisposition | null
    ) => CreateActivityData | null = () => null
  ): Promise<{ row: FindingRow; from: FindingDisposition | null }> {
    return prisma.$transaction(async tx => {
      const prior = await tx.prSecurityFinding.findUnique({
        where: { id: findingId },
        select: { disposition: true },
      })
      const from = (prior?.disposition ?? null) as FindingDisposition | null
      // Compare-and-set on `from`: a concurrent ruling that landed between
      // the read and this write makes the count 0 (Postgres re-checks the
      // predicate after the row lock), so `from` is never stale. No raw SQL.
      const { count } = await tx.prSecurityFinding.updateMany({
        where: { id: findingId, disposition: from },
        data,
      })
      if (count === 0) {
        throw Object.assign(
          new Error(
            'The finding was ruled concurrently — reload and try again'
          ),
          { status: 409 }
        )
      }
      const row = await tx.prSecurityFinding.findUniqueOrThrow({
        where: { id: findingId },
      })
      const activity = activityFor(from)
      if (activity) await activityRepository.create(activity, tx)
      return { row: row as unknown as FindingRow, from }
    })
  },

  // ── LUM-740: suggested dispositions ───────────────────────────────────────

  /**
   * The scan's undispositioned, non-persisting EXTERNAL_TOOL findings that
   * sit on a line and have no suggestion yet — DEPENDENCY rows have no line
   * to show a falsifier. `null` when the scan is missing.
   */
  async findScanForSuggestion(
    scanId: string
  ): Promise<ScanForSuggestion | null> {
    const row = await prisma.prSecurityScan.findUnique({
      where: { id: scanId },
      select: {
        id: true,
        pullRequest: {
          select: { workspaceId: true, repo: true, number: true },
        },
        findings: {
          where: {
            provenance: 'EXTERNAL_TOOL',
            disposition: null,
            persisting: false,
            suggestedDisposition: null,
            line: { not: null },
            kind: { not: 'DEPENDENCY' },
          },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            ruleId: true,
            severity: true,
            filePath: true,
            line: true,
            title: true,
            detail: true,
            externalRef: true,
          },
        },
      },
    })
    return row as unknown as ScanForSuggestion | null
  },

  /** A REJECT from the falsifier: a suggestion, never `disposition`. */
  async setSuggestedDisposition(
    findingId: string,
    suggestedDisposition: FindingDisposition,
    suggestedReason: string
  ): Promise<void> {
    await prisma.prSecurityFinding.update({
      where: { id: findingId },
      data: { suggestedDisposition, suggestedReason },
    })
  },

  /**
   * Adds to `suggestionTokens` (team rule: null ≠ 0, so a null row becomes
   * `n` rather than staying null as a SQL increment would). Own column: the
   * hunt owns `tokenSpent` and overwrites it.
   */
  async addSuggestionTokens(scanId: string, n: number): Promise<void> {
    await prisma.$transaction(async tx => {
      const row = await tx.prSecurityScan.findUnique({
        where: { id: scanId },
        select: { suggestionTokens: true },
      })
      if (!row) return
      await tx.prSecurityScan.update({
        where: { id: scanId },
        data: { suggestionTokens: (row.suggestionTokens ?? 0) + n },
      })
    })
  },

  // ── LUM-988: agentic verifier ─────────────────────────────────────────────

  /** The verifier was started for this scan: LLM_JUDGE inline comments now wait. */
  async markVerifierStarted(scanId: string): Promise<void> {
    await prisma.prSecurityScan.update({
      where: { id: scanId },
      data: { verifierStartedAt: new Date() },
    })
  },

  /**
   * Scans whose verifier started before `startedBefore` and never stamped
   * `verifiedAt` — a run or step that was lost. Oldest first.
   */
  async findStaleVerifierHolds(
    startedBefore: Date,
    limit: number
  ): Promise<string[]> {
    const rows = await prisma.prSecurityScan.findMany({
      where: { verifiedAt: null, verifierStartedAt: { lt: startedBefore } },
      orderBy: { verifierStartedAt: 'asc' },
      take: limit,
      select: { id: true },
    })
    return rows.map(r => r.id)
  },

  /**
   * Release one stale hold: stamp `verifiedAt` only if it is still null, so a
   * verifier finishing at the same moment and the sweep never both act.
   * true = this call released it.
   */
  async claimStaleVerifierHold(
    scanId: string,
    startedBefore: Date
  ): Promise<boolean> {
    const res = await prisma.prSecurityScan.updateMany({
      where: {
        id: scanId,
        verifiedAt: null,
        verifierStartedAt: { lt: startedBefore },
      },
      data: { verifiedAt: new Date() },
    })
    return res.count === 1
  },

  /** The scan's LLM_JUDGE findings, as the verifier reads them (evidence included). */
  async findJudgeFindingsForVerify(
    scanId: string
  ): Promise<JudgeFindingForVerify[]> {
    const rows = await prisma.prSecurityFinding.findMany({
      where: { scanId, provenance: 'LLM_JUDGE' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        kind: true,
        ruleId: true,
        severity: true,
        filePath: true,
        line: true,
        title: true,
        detail: true,
        evidence: true,
      },
    })
    return rows as JudgeFindingForVerify[]
  },

  /**
   * Writes the verdicts and stamps `verifiedAt` in one transaction, so a
   * write-back never sees the stamp without the verdicts. Called with an
   * empty list when the verifier failed: the stamp alone releases the hold.
   */
  async completeVerification(
    scanId: string,
    verdicts: Array<{
      findingId: string
      verdict: VerifierVerdict
      reason: string
    }>
  ): Promise<void> {
    await prisma.$transaction([
      ...verdicts.map(v =>
        prisma.prSecurityFinding.updateMany({
          where: { id: v.findingId, scanId, provenance: 'LLM_JUDGE' },
          data: { verifierVerdict: v.verdict, verifierReason: v.reason },
        })
      ),
      prisma.prSecurityScan.update({
        where: { id: scanId },
        data: { verifiedAt: new Date() },
      }),
    ])
  },

  /** The suggested-disposition pass finished for this scan (see `suggestedAt`). */
  async markSuggested(scanId: string): Promise<void> {
    await prisma.prSecurityScan.update({
      where: { id: scanId },
      data: { suggestedAt: new Date() },
    })
  },

  // ── LUM-740: fixed-since-previous-scan ────────────────────────────────────

  /**
   * The open (undispositioned, non-persisting) fingerprints of the PR's
   * newest scan that started before `before` — the read model diffs them
   * against the latest scan to say how many findings the push fixed.
   */
  async findPreviousOpenFingerprints(
    pullRequestId: string,
    before: Date
  ): Promise<string[]> {
    const row = await prisma.prSecurityScan.findFirst({
      where: { pullRequestId, startedAt: { lt: before } },
      orderBy: { startedAt: 'desc' },
      select: {
        findings: {
          where: { disposition: null, persisting: false },
          select: { fingerprint: true },
        },
      },
    })
    return row ? row.findings.map(f => f.fingerprint) : []
  },

  // ── LUM-740: bulk confirm ─────────────────────────────────────────────────

  /**
   * Every undispositioned finding on the given scans the falsifier suggested
   * as a false positive becomes FALSE_POSITIVE / CONFIRMED in one write.
   * The service passes the task's latest scan per PR — what the panel shows
   * and counts. Returns how many rows changed.
   */
  async confirmSuggestedByScanIds(
    scanIds: string[],
    data: {
      dispositionNote: string
      dispositionedById: string
      dispositionedAt: Date
    }
  ): Promise<number> {
    if (scanIds.length === 0) return 0
    const { count } = await prisma.prSecurityFinding.updateMany({
      where: {
        scanId: { in: scanIds },
        suggestedDisposition: 'FALSE_POSITIVE',
        disposition: null,
      },
      data: {
        disposition: 'FALSE_POSITIVE',
        suggestionOutcome: 'CONFIRMED',
        ...data,
      },
    })
    return count
  },

  // ── LUM-740: summary comment id ───────────────────────────────────────────

  /** The per-PR summary comment an earlier scan of this PR already owns. */
  async findSummaryCommentIdByPullRequest(
    pullRequestId: string
  ): Promise<string | null> {
    const row = await prisma.prSecurityScan.findFirst({
      where: { pullRequestId, summaryCommentId: { not: null } },
      orderBy: { startedAt: 'desc' },
      select: { summaryCommentId: true },
    })
    return row?.summaryCommentId ?? null
  },

  /**
   * LUM-924 — whether another workspace also holds a row for this PR (same
   * repository and number). Workspaces sharing a GitHub App installation post
   * their summaries as the same bot, so a marker match can be the other's.
   */
  async isPullRequestHeldElsewhere(pullRequestId: string): Promise<boolean> {
    const pr = await prisma.pullRequest.findUnique({
      where: { id: pullRequestId },
      select: { repo: true, number: true },
    })
    if (!pr) return false
    const others = await prisma.pullRequest.count({
      where: { repo: pr.repo, number: pr.number, id: { not: pullRequestId } },
    })
    return others > 0
  },

  /**
   * LUM-1140 — this workspace's open PRs, most recently updated first, at
   * most `limit` (the bulk withdrawal after the request-changes workflow is
   * turned off; a PR past the cap is caught at its next review).
   */
  async findOpenPullRequestsOfWorkspace(
    workspaceId: string,
    limit: number
  ): Promise<Array<{ id: string; repo: string; number: number }>> {
    return prisma.pullRequest.findMany({
      where: { workspaceId, state: 'open' },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, repo: true, number: true },
    })
  },

  /**
   * LUM-1140 — whether another workspace that holds this PR (same repository
   * and number, LUM-924) has the request-changes workflow on: Lumo's App
   * reviews as one bot for every workspace sharing the installation, so a
   * standing "changes requested" may be that workspace's to keep.
   */
  async isRequestChangesOnElsewhere(pr: {
    id: string
    repo: string
    number: number
  }): Promise<boolean> {
    const others = await prisma.pullRequest.count({
      where: {
        repo: pr.repo,
        number: pr.number,
        id: { not: pr.id },
        workspace: { securityRequestChangesEnabled: true },
      },
    })
    return others > 0
  },

  /** LUM-1148: the pre-merge checks' results on this scan's head (null clears). */
  async setPreMergeChecks(
    scanId: string,
    record: object | null
  ): Promise<void> {
    await prisma.prSecurityScan.update({
      where: { id: scanId },
      data: {
        preMergeChecks:
          record === null ? Prisma.DbNull : (record as Prisma.InputJsonValue),
      },
    })
  },

  /**
   * LUM-1148: this scan's stored pre-merge check results, raw (null = none
   * or no such scan). Read back by the runner when a model call fails, so an
   * earlier failure of the same head is kept rather than overwritten.
   */
  async findPreMergeChecks(scanId: string): Promise<unknown> {
    const row = await prisma.prSecurityScan.findUnique({
      where: { id: scanId },
      select: { preMergeChecks: true },
    })
    return row?.preMergeChecks ?? null
  },

  /**
   * LUM-1148: the PR's newest scan — its head and whether pre-merge checks
   * ran on it — for a re-check after the title / description changed.
   */
  async findLatestChecksTarget(pullRequestId: string): Promise<{
    id: string
    headSha: string
    preMergeChecks: unknown
  } | null> {
    return prisma.prSecurityScan.findFirst({
      where: { pullRequestId },
      orderBy: { startedAt: 'desc' },
      select: { id: true, headSha: true, preMergeChecks: true },
    })
  },

  /** LUM-1146 — how `.lumo.yaml` was read for this scan (for the summary). */
  async setRepoConfig(scanId: string, repoConfig: object): Promise<void> {
    await prisma.prSecurityScan.update({
      where: { id: scanId },
      data: { repoConfig: repoConfig as Prisma.InputJsonValue },
    })
  },

  /** LUM-1147 — the review profile in force for this scan (for the write-back). */
  async setReviewProfile(scanId: string, reviewProfile: string): Promise<void> {
    await prisma.prSecurityScan.update({
      where: { id: scanId },
      data: { reviewProfile },
    })
  },

  /** LUM-1151 — where this scan's high-level summary goes (for the write-back). */
  async setHighLevelSummary(
    scanId: string,
    highLevelSummary: string
  ): Promise<void> {
    await prisma.prSecurityScan.update({
      where: { id: scanId },
      data: { highLevelSummary },
    })
  },

  /**
   * LUM-1151 — for `@<app> summary`: the newest scan of the PR that carries
   * a summary, else the newest scan at all (so the reply can say which
   * review had none); null when the PR was never scanned.
   */
  async findLatestSummaryByPullRequest(pullRequestId: string): Promise<{
    id: string
    headSha: string
    prSummary: unknown
    highLevelSummary: string | null
  } | null> {
    const select = {
      id: true,
      headSha: true,
      prSummary: true,
      highLevelSummary: true,
    } as const
    const withSummary = await prisma.prSecurityScan.findFirst({
      where: { pullRequestId, prSummary: { not: Prisma.DbNull } },
      orderBy: { startedAt: 'desc' },
      select,
    })
    if (withSummary) return withSummary
    return prisma.prSecurityScan.findFirst({
      where: { pullRequestId },
      orderBy: { startedAt: 'desc' },
      select,
    })
  },

  async setSummaryCommentId(
    scanId: string,
    summaryCommentId: string
  ): Promise<void> {
    await prisma.prSecurityScan.update({
      where: { id: scanId },
      data: { summaryCommentId },
    })
  },

  /**
   * LUM-1150 — claim the right to post these finding rows' inline comments;
   * returns the ids this caller won. Each row is one conditional update, so
   * of two concurrent write-backs exactly one sees count 1 (Postgres
   * re-checks the WHERE once the other's row lock is released). A claim
   * taken before `staleBefore` is treated as abandoned and can be won again.
   */
  async claimInlineComments(
    findingIds: string[],
    staleBefore: Date
  ): Promise<Set<string>> {
    const won = new Set<string>()
    for (const id of findingIds) {
      const { count } = await prisma.prSecurityFinding.updateMany({
        where: {
          id,
          OR: [
            { inlineCommentClaimedAt: null },
            { inlineCommentClaimedAt: { lt: staleBefore } },
          ],
        },
        data: { inlineCommentClaimedAt: new Date() },
      })
      if (count === 1) won.add(id)
    }
    return won
  },

  /** LUM-1150 — give claims back after a post that did not land. */
  async releaseInlineCommentClaims(findingIds: string[]): Promise<void> {
    if (findingIds.length === 0) return
    await prisma.prSecurityFinding.updateMany({
      where: { id: { in: findingIds } },
      data: { inlineCommentClaimedAt: null },
    })
  },

  // ── LUM-745: managed-run ops ───────────────────────────────────────────────

  /**
   * The workflow run stage A just started; supersede / sweep cancel by it.
   * LUM-745 (review): the external + supplyChain layers go PENDING in the
   * same write, so the row is supersedable the moment the run exists —
   * stage A's own `persistResult` is many seconds away (behind the LLM
   * judge) and a back-to-back push must find this row in between. An
   * external layer another writer already settled (RAN / FAILED /
   * SUPERSEDED) is never downgraded.
   */
  async setManagedRunId(id: string, managedRunId: string): Promise<void> {
    await withSerializableRetry(async tx => {
      const current = await tx.prSecurityScan.findUnique({
        where: { id },
        select: { stages: true },
      })
      const stages: ScanStages = {
        ...((current?.stages as ScanStages | null) ?? {}),
      }
      const settled =
        stages.external === 'RAN' ||
        stages.external === 'FAILED' ||
        stages.external === 'SUPERSEDED'
      if (!settled) {
        stages.external = 'PENDING'
        if (!stages.supplyChain) stages.supplyChain = 'PENDING'
      }
      await tx.prSecurityScan.update({
        where: { id },
        data: { managedRunId, stages },
      })
    })
  },

  /** The per-layer JSON alone — the sandbox step's entry guard. */
  async findStagesById(id: string): Promise<ScanStages | null> {
    const row = await prisma.prSecurityScan.findUnique({
      where: { id },
      select: { stages: true },
    })
    if (!row) return null
    return (row.stages as ScanStages | null) ?? {}
  },

  /**
   * Every other scan on this PR whose managed run may still be going:
   * `stages.external = PENDING` and a run id on record. The caller already
   * knows the newest row's id and excludes it; anything else on the PR is by
   * construction not the head (stage A resolved the head before creating it).
   */
  async findPendingManagedByPullRequest(
    pullRequestId: string,
    exceptScanId: string
  ): Promise<SupersedableScan[]> {
    const rows = await prisma.prSecurityScan.findMany({
      where: {
        pullRequestId,
        id: { not: exceptScanId },
        managedRunId: { not: null },
        stages: { path: ['external'], equals: 'PENDING' },
      },
      select: { id: true, headSha: true, managedRunId: true, stages: true },
    })
    return rows as SupersedableScan[]
  },

  /** PENDING external layers started before `before` (managed and BYO), oldest first. */
  async findStalePendingExternal(
    before: Date,
    limit: number
  ): Promise<StalePendingScan[]> {
    const rows = await prisma.prSecurityScan.findMany({
      where: {
        startedAt: { lt: before },
        stages: { path: ['external'], equals: 'PENDING' },
      },
      orderBy: { startedAt: 'asc' },
      take: limit,
      select: { id: true, managedRunId: true, stages: true },
    })
    return rows as StalePendingScan[]
  },

  /** Managed runs this workspace started since `since` — the hourly cap's counter. */
  async countManagedRunsSince(
    workspaceId: string,
    since: Date
  ): Promise<number> {
    return prisma.prSecurityScan.count({
      where: {
        workspaceId,
        managedRunId: { not: null },
        startedAt: { gte: since },
      },
    })
  },
}
