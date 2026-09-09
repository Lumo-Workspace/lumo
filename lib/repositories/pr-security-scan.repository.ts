/**
 * LUM-732 — Prisma access for PR security scans and findings.
 * No business logic: the service decides dedup, inheritance and status.
 */
import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { ScanStages } from '@/lib/security-scan/types'

export type ScanStatus = 'PENDING' | 'RUNNING' | 'CLEAN' | 'FINDINGS' | 'FAILED'
export type ScanTrigger = 'PR_EVENT' | 'PR_LINK' | 'SARIF_PUSH'
export type JudgeStatus = 'RAN' | 'UNAVAILABLE' | 'SKIPPED'
export type FindingKind = 'SECRET' | 'VULNERABILITY'
export type FindingSeverity = 'LOW' | 'MEDIUM' | 'HIGH'
export type FindingProvenance = 'DETERMINISTIC' | 'LLM_JUDGE' | 'EXTERNAL_TOOL'
export type FindingDisposition = 'FALSE_POSITIVE' | 'ACCEPTED_RISK'

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
  findings: FindingRow[]
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
  current: { stages: unknown; partial?: boolean | null } | null,
  incoming: { stages: ScanStages; partial: boolean }
): { stages: ScanStages; partial: boolean } {
  const owned = (current?.stages as ScanStages | null)?.external
  const stages: ScanStages =
    owned === 'RAN' || owned === 'FAILED'
      ? { ...incoming.stages, external: owned }
      : incoming.stages
  return {
    stages,
    partial: (current?.partial ?? false) || incoming.partial,
  }
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
          stages: external ? { external } : Prisma.DbNull,
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
        select: { stages: true, partial: true },
      })
      const { stages, partial } = mergeIngestOwnedStages(current, input)
      await tx.prSecurityScan.update({
        where: { id },
        data: {
          status: input.status,
          judgeStatus: input.judgeStatus,
          truncated: input.truncated,
          stages,
          partial,
          error: input.error ?? null,
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
        select: { stages: true, partial: true },
      })
      const { stages, partial } = mergeIngestOwnedStages(current, final)
      await tx.prSecurityScan.update({
        where: { id: scanId },
        data: {
          status: final.status,
          judgeStatus: final.judgeStatus,
          truncated: final.truncated,
          stages,
          partial,
          error: final.error ?? null,
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
    opts: { partial: boolean }
  ): Promise<{ written: number; flippedToFindings: boolean }> {
    const uniqueTools = Array.from(new Set(tools))
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
            external: 'RAN',
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
    extra: { partial?: boolean; status?: 'FINDINGS' } = {}
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
        },
      })
    })
  },

  async countExternalFindings(scanId: string): Promise<number> {
    return prisma.prSecurityFinding.count({
      where: { scanId, provenance: 'EXTERNAL_TOOL' },
    })
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
}
