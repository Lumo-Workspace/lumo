/**
 * LUM-732 — Prisma access for PR security scans and findings.
 * No business logic: the service decides dedup, inheritance and status.
 */
import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { ScanStages } from '@/lib/security-scan/types'
import { EXTERNAL_ERROR_PREFIX } from '@/lib/security-scan/stages'

export type ScanStatus = 'PENDING' | 'RUNNING' | 'CLEAN' | 'FINDINGS' | 'FAILED'
export type ScanTrigger = 'PR_EVENT' | 'PR_LINK' | 'SARIF_PUSH'
export type JudgeStatus = 'RAN' | 'UNAVAILABLE' | 'SKIPPED'
export type FindingKind = 'SECRET' | 'VULNERABILITY' | 'DEPENDENCY'
export type FindingSeverity = 'LOW' | 'MEDIUM' | 'HIGH'
export type FindingProvenance = 'DETERMINISTIC' | 'LLM_JUDGE' | 'EXTERNAL_TOOL'
export type FindingDisposition = 'FALSE_POSITIVE' | 'ACCEPTED_RISK'
// LUM-739 — mirror the Prisma enums as string unions (same style as above).
export type FindingReachability = 'EXTERNAL' | 'INTERNAL' | 'UNKNOWN'
export type FalsifierVerdict = 'REJECT' | 'INCONCLUSIVE'
// LUM-740 — what a human did with an LLM-suggested disposition.
export type SuggestionOutcome = 'CONFIRMED' | 'OVERRULED'

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
}

/** LUM-739 — what the hunt workflow writes back onto the scan row. */
export interface PersistHuntResultInput {
  hunt: 'RAN' | 'PARTIAL' | 'FAILED'
  huntAudit: Record<string, unknown>
  tokenSpent: number | null
  partial: boolean
}

export interface FinalizeScanInput {
  status: ScanStatus
  judgeStatus: JudgeStatus | null
  truncated: boolean
  /** LUM-735 — per-layer outcomes; whatever was collected when the scan ended. */
  stages: ScanStages
  /** LUM-735 — a layer hit its cap; results are honest but not whole. */
  partial: boolean
  error?: string | null
}

/** LUM-745 — an older scan on the same PR whose managed run may still be going. */
export interface SupersedableScan {
  id: string
  headSha: string
  managedRunId: string
  stages: ScanStages | null
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
  /** LUM-738: already on the default-branch baseline — not introduced by this PR. */
  persisting: boolean
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
  findings: FindingRow[]
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
>

/**
 * LUM-735 Task 2 — one scan with everything the PR write-back renders: its
 * findings, the PR to comment on, and the task/workspace the "Open in Lumo"
 * link points at.
 */
export interface ScanForReview {
  id: string
  headSha: string
  stages: ScanStages | null
  partial: boolean
  error: string | null
  /** LUM-740: the summary comment this scan (or an earlier one) already owns. */
  summaryCommentId: string | null
  findings: ReviewFindingRow[]
  pullRequest: {
    id: string
    repo: string
    number: number
    workspaceId: string
    task: { number: number; team: { identifier: string } } | null
    /** `securityPolicy` is the raw Json column — parse with `parseSecurityPolicy`. */
    workspace: { slug: string; securityPolicy: unknown }
  }
}

export interface DispositionedFingerprint {
  id: string
  fingerprint: string
  disposition: FindingDisposition
  dispositionNote: string | null
  dispositionedById: string | null
  dispositionedAt: Date | null
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
function mergeIngestOwnedStages(
  current: {
    stages: unknown
    partial?: boolean | null
    error?: string | null
  } | null,
  incoming: { stages: ScanStages; partial: boolean }
): { stages: ScanStages; partial: boolean; error?: string } {
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
    partial: (current?.partial ?? false) || incoming.partial,
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

export const prSecurityScanRepository = {
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
  async claimPending(id: string): Promise<void> {
    await prisma.prSecurityScan.update({
      where: { id },
      data: { status: 'RUNNING', startedAt: new Date(), error: null },
    })
  },

  /**
   * A FAILED scan is re-run in place. Only stage A's own rows go — EXTERNAL_TOOL
   * findings and the ingest-owned `stages.external` were written by the SARIF
   * push and are not stage A's to discard (LUM-735).
   */
  async restart(id: string): Promise<void> {
    await withSerializableRetry(async tx => {
      const current = await tx.prSecurityScan.findUnique({
        where: { id },
        select: { stages: true },
      })
      const external = (current?.stages as ScanStages | null)?.external
      await tx.prSecurityFinding.deleteMany({
        where: { scanId: id, provenance: { not: 'EXTERNAL_TOOL' } },
      })
      await tx.prSecurityScan.update({
        where: { id },
        data: {
          status: 'RUNNING',
          judgeStatus: null,
          truncated: false,
          // LUM-745: a superseded layer carries no result and no rows —
          // preserving it would leave the re-run permanently "superseded".
          stages:
            external && external !== 'SUPERSEDED'
              ? { external }
              : Prisma.DbNull,
          partial: false,
          error: null,
          startedAt: new Date(),
          finishedAt: null,
        },
      })
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
        select: { stages: true, partial: true, error: true },
      })
      const {
        stages,
        partial,
        error: keptError,
      } = mergeIngestOwnedStages(current, input)
      await tx.prSecurityScan.update({
        where: { id },
        data: {
          status: input.status,
          judgeStatus: input.judgeStatus,
          truncated: input.truncated,
          stages,
          partial,
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
        select: { stages: true, partial: true, error: true },
      })
      const {
        stages,
        partial,
        error: keptError,
      } = mergeIngestOwnedStages(current, final)
      await tx.prSecurityScan.update({
        where: { id: scanId },
        data: {
          status: final.status,
          judgeStatus: final.judgeStatus,
          truncated: final.truncated,
          stages,
          partial,
          error: final.error ?? keptError ?? null,
          finishedAt: new Date(),
        },
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
    opts: { partial: boolean; stage?: 'external' | 'supplyChain' }
  ): Promise<{ written: number; flippedToFindings: boolean }> {
    const uniqueTools = Array.from(new Set(tools))
    // LUM-738: osv-scanner's rows land under `supplyChain`; everything else
    // (semgrep, gitleaks, BYO SARIF) is the `external` layer.
    const stage = opts.stage ?? 'external'
    return withSerializableRetry(async tx => {
      const current = await tx.prSecurityScan.findUnique({
        where: { id: scanId },
        select: { status: true, stages: true, partial: true },
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
          partial: (current?.partial ?? false) || opts.partial,
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
    extra: { partial?: boolean; status?: 'FINDINGS'; error?: string } = {}
  ): Promise<void> {
    await withSerializableRetry(async tx => {
      const current = await tx.prSecurityScan.findUnique({
        where: { id: scanId },
        select: { stages: true, partial: true },
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
          ...(extra.partial !== undefined
            ? { partial: (current?.partial ?? false) || extra.partial }
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
  ): Promise<void> {
    await withSerializableRetry(async tx => {
      const current = await tx.prSecurityScan.findUnique({
        where: { id: scanId },
        select: { stages: true, partial: true },
      })
      const stages: ScanStages = {
        ...((current?.stages as ScanStages | null) ?? {}),
        hunt: final.hunt,
      }
      await tx.prSecurityScan.update({
        where: { id: scanId },
        data: {
          stages,
          partial: (current?.partial ?? false) || final.partial,
          huntAudit: final.huntAudit as Prisma.InputJsonValue,
          tokenSpent: final.tokenSpent,
          ...(findings.length > 0 ? { status: 'FINDINGS' } : {}),
        },
      })
      if (findings.length > 0)
        await tx.prSecurityFinding.createMany({ data: findings })
    })
  },

  async countExternalFindings(scanId: string): Promise<number> {
    return prisma.prSecurityFinding.count({
      where: { scanId, provenance: 'EXTERNAL_TOOL' },
    })
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
        stages: true,
        partial: true,
        error: true,
        summaryCommentId: true,
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
          },
        },
        pullRequest: {
          select: {
            id: true,
            repo: true,
            number: true,
            workspaceId: true,
            task: {
              select: { number: true, team: { select: { identifier: true } } },
            },
            workspace: { select: { slug: true, securityPolicy: true } },
          },
        },
      },
    })
    return row as unknown as ScanForReview | null
  },

  async findDispositionedByPullRequest(
    pullRequestId: string
  ): Promise<DispositionedFingerprint[]> {
    const rows = await prisma.prSecurityFinding.findMany({
      where: { scan: { pullRequestId }, disposition: { not: null } },
      orderBy: { dispositionedAt: { sort: 'desc', nulls: 'last' } },
      select: {
        id: true,
        fingerprint: true,
        disposition: true,
        dispositionNote: true,
        dispositionedById: true,
        dispositionedAt: true,
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

  async updateDisposition(
    findingId: string,
    data: {
      disposition: FindingDisposition
      dispositionNote: string | null
      dispositionedById: string
      dispositionedAt: Date
    }
  ): Promise<FindingRow> {
    const row = await prisma.prSecurityFinding.update({
      where: { id: findingId },
      data,
    })
    return row as unknown as FindingRow
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
   * Adds to `tokenSpent` (team rule: null ≠ 0, so a null row becomes `n`
   * rather than staying null as a SQL increment would).
   */
  async addTokenSpent(scanId: string, n: number): Promise<void> {
    await prisma.$transaction(async tx => {
      const row = await tx.prSecurityScan.findUnique({
        where: { id: scanId },
        select: { tokenSpent: true },
      })
      if (!row) return
      await tx.prSecurityScan.update({
        where: { id: scanId },
        data: { tokenSpent: (row.tokenSpent ?? 0) + n },
      })
    })
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

  async setSummaryCommentId(
    scanId: string,
    summaryCommentId: string
  ): Promise<void> {
    await prisma.prSecurityScan.update({
      where: { id: scanId },
      data: { summaryCommentId },
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
