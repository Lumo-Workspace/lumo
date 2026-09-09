/**
 * LUM-732 — Prisma access for PR security scans and findings.
 * No business logic: the service decides dedup, inheritance and status.
 */
import { prisma } from '@/lib/db/prisma'

export type ScanStatus = 'PENDING' | 'RUNNING' | 'CLEAN' | 'FINDINGS' | 'FAILED'
export type ScanTrigger = 'PR_EVENT' | 'PR_LINK'
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

  /** A FAILED scan is re-run in place: old findings go, status back to RUNNING. */
  async restart(id: string): Promise<void> {
    await prisma.prSecurityFinding.deleteMany({ where: { scanId: id } })
    await prisma.prSecurityScan.update({
      where: { id },
      data: {
        status: 'RUNNING',
        judgeStatus: null,
        truncated: false,
        error: null,
        startedAt: new Date(),
        finishedAt: null,
      },
    })
  },

  async finalize(id: string, input: FinalizeScanInput): Promise<void> {
    await prisma.prSecurityScan.update({
      where: { id },
      data: {
        status: input.status,
        judgeStatus: input.judgeStatus,
        truncated: input.truncated,
        error: input.error ?? null,
        finishedAt: new Date(),
      },
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
    const ops = []
    if (findings.length > 0)
      ops.push(prisma.prSecurityFinding.createMany({ data: findings }))
    ops.push(
      prisma.prSecurityScan.update({
        where: { id: scanId },
        data: {
          status: final.status,
          judgeStatus: final.judgeStatus,
          truncated: final.truncated,
          error: final.error ?? null,
          finishedAt: new Date(),
        },
      })
    )
    await prisma.$transaction(ops)
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
