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
  /** EXTERNAL_TOOL alert URL, or the secret-scanning alert that upgraded an A1 hit. */
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
 * LUM-735 — the row is shared by stage A and the SARIF ingest worker: an
 * ingest-owned `stages.external` (RAN or FAILED, i.e. a report has actually
 * landed or the ingest itself blew up) must survive whatever stage A writes
 * over it, and `partial` is monotone across the two writers — once either
 * side has hit a cap it can never be cleared by the other. Shared by
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
    await prisma.$transaction(async tx => {
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
    await prisma.$transaction(async tx => {
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
   */
  async persistResult(
    scanId: string,
    findings: NewFindingInput[],
    final: FinalizeScanInput
  ): Promise<void> {
    await prisma.$transaction(async tx => {
      const current = await tx.prSecurityScan.findUnique({
        where: { id: scanId },
        select: { stages: true, partial: true },
      })
      const { stages, partial } = mergeIngestOwnedStages(current, final)
      if (findings.length > 0)
        await tx.prSecurityFinding.createMany({ data: findings })
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
    })
  },

  /**
   * Same (scan, tool) pushed again → last push wins, atomically (LUM-735).
   * A single SARIF document can carry multiple runs (e.g. semgrep + a
   * secondary ruleset) each prefixing `ruleId` with its own tool slug — so
   * every run's tool must be named here, or rows from runs other than the
   * first accumulate across pushes instead of being replaced. `tools` is
   * deduped; an empty list is a caller bug and deletes nothing.
   */
  async replaceExternalFindings(
    scanId: string,
    tools: string[],
    rows: NewFindingInput[]
  ): Promise<number> {
    const uniqueTools = Array.from(new Set(tools))
    return prisma.$transaction(async tx => {
      if (uniqueTools.length > 0) {
        await tx.prSecurityFinding.deleteMany({
          where: {
            scanId,
            provenance: 'EXTERNAL_TOOL',
            OR: uniqueTools.map(t => ({ ruleId: { startsWith: `ext:${t}:` } })),
          },
        })
      }
      if (rows.length === 0) return 0
      const res = await tx.prSecurityFinding.createMany({ data: rows })
      return res.count
    })
  },

  /** Read-modify-write of the per-layer JSON; the ingest path's only write to the scan row. */
  async mergeStages(
    scanId: string,
    patch: ScanStages,
    extra: { partial?: boolean; status?: 'FINDINGS' } = {}
  ): Promise<void> {
    await prisma.$transaction(async tx => {
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
          // this call can never clear a `true` set by the other writer.
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

  async findScanRow(id: string): Promise<{
    id: string
    status: ScanStatus
    stages: ScanStages | null
    partial: boolean
    startedAt: Date
  } | null> {
    const row = await prisma.prSecurityScan.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        stages: true,
        partial: true,
        startedAt: true,
      },
    })
    return row as {
      id: string
      status: ScanStatus
      stages: ScanStages | null
      partial: boolean
      startedAt: Date
    } | null
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
