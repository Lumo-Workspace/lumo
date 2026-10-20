/**
 * LUM-1259 — the local scan log: one `LocalScanRun` per commit a developer's
 * CLI scanned, with its findings (fingerprint, rule, position, redacted
 * title). Client-reported; nothing here feeds the DONE gate. Every query
 * pins the workspace (`scopedPrisma`). Queries only.
 */
import { Prisma } from '@prisma/client'
import { scopedPrisma } from '@/lib/db/workspace-scope'

export type LocalScanActor = 'USER' | 'AGENT'
export type LocalScanTrigger = 'POST_COMMIT' | 'PRE_PUSH' | 'MANUAL'
export type LocalScanSeverity = 'LOW' | 'MEDIUM' | 'HIGH'

export interface LocalScanFindingRow {
  scanner: string
  fingerprint: string
  ruleId: string
  severity: LocalScanSeverity
  filePath: string
  line: number
  title: string
  label: string | null
}

export interface NewLocalScanRun {
  workspaceId: string
  repo: string
  commitSha: string
  parentSha: string | null
  patchId: string | null
  branch: string | null
  sessionId: string | null
  taskId: string | null
  actor: LocalScanActor
  memberId: string
  trigger: LocalScanTrigger
  scanners: string[]
  scannerVersion: string
  cliVersion: string | null
  filesScanned: number
  findingCount: number
  resultKey: string
  scannedAt: Date
  findings: LocalScanFindingRow[]
}

export interface LocalScanRunRow {
  id: string
  commitSha: string
  patchId: string | null
  branch: string | null
  actor: LocalScanActor
  trigger: LocalScanTrigger
  scanners: string[]
  findingCount: number
  scannedAt: Date
  createdAt: Date
  findings: LocalScanFindingRow[]
}

const RUN_SELECT = {
  id: true,
  commitSha: true,
  patchId: true,
  branch: true,
  actor: true,
  trigger: true,
  scanners: true,
  findingCount: true,
  scannedAt: true,
  createdAt: true,
  findings: {
    orderBy: [{ filePath: 'asc' }, { line: 'asc' }],
    select: {
      scanner: true,
      fingerprint: true,
      ruleId: true,
      severity: true,
      filePath: true,
      line: true,
      title: true,
      label: true,
    },
  },
} satisfies Prisma.LocalScanRunSelect

export const localScanLogRepository = {
  /**
   * The stored spelling of `repo` among the repositories linked to the
   * workspace's projects (GitHub names are case-insensitive), or null when
   * the workspace has no such repository.
   */
  async findLinkedRepo(
    workspaceId: string,
    repo: string
  ): Promise<string | null> {
    const rows = await scopedPrisma.projectRepository.findMany({
      where: {
        fullName: { equals: repo, mode: 'insensitive' },
        project: { workspaceId },
      },
      orderBy: { createdAt: 'asc' },
      select: { fullName: true },
      take: 10,
    })
    // ILIKE treats `_` as a wildcard: the exact case-folded match decides.
    const want = repo.toLowerCase()
    return rows.find(r => r.fullName.toLowerCase() === want)?.fullName ?? null
  },

  /** The run an identical earlier upload created, if any (dedupe). */
  async findByResultKey(
    workspaceId: string,
    repo: string,
    commitSha: string,
    resultKey: string
  ): Promise<{ id: string } | null> {
    return scopedPrisma.localScanRun.findUnique({
      where: {
        workspaceId_repo_commitSha_resultKey: {
          workspaceId,
          repo,
          commitSha,
          resultKey,
        },
      },
      select: { id: true },
    })
  },

  /**
   * Create the run and its findings in one write. Returns null when an
   * identical run landed first (the unique key on workspace, repo, commit
   * and result) — the caller reports it as a duplicate.
   */
  async create(run: NewLocalScanRun): Promise<{ id: string } | null> {
    const { findings, ...row } = run
    try {
      return await scopedPrisma.localScanRun.create({
        data: { ...row, findings: { create: findings } },
        select: { id: true },
      })
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        return null
      throw err
    }
  },

  /**
   * The runs of the repository's commit `commitSha`, and of every commit
   * that shares a patch-id with one of them (the same change before an
   * amend or a rebase), newest first, at most `limit`.
   */
  async findHistoryForCommit(
    workspaceId: string,
    repos: string[],
    commitSha: string,
    limit: number
  ): Promise<LocalScanRunRow[]> {
    if (repos.length === 0) return []
    const direct = await scopedPrisma.localScanRun.findMany({
      where: { workspaceId, repo: { in: repos }, commitSha },
      select: { patchId: true },
      take: limit,
    })
    const patchIds = [
      ...new Set(direct.flatMap(r => (r.patchId ? [r.patchId] : []))),
    ]
    return scopedPrisma.localScanRun.findMany({
      where: {
        workspaceId,
        repo: { in: repos },
        OR: [
          { commitSha },
          ...(patchIds.length > 0 ? [{ patchId: { in: patchIds } }] : []),
        ],
      },
      orderBy: { scannedAt: 'desc' },
      take: limit,
      select: RUN_SELECT,
    })
  },

  /** Every stored spelling of `repo` among the workspace's logged runs. */
  async findRepoSpellings(
    workspaceId: string,
    repo: string
  ): Promise<string[]> {
    const rows = await scopedPrisma.localScanRun.groupBy({
      by: ['repo'],
      where: { workspaceId, repo: { equals: repo, mode: 'insensitive' } },
    })
    const want = repo.toLowerCase()
    return rows.map(r => r.repo).filter(r => r.toLowerCase() === want)
  },
}
