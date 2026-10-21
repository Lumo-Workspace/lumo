/**
 * @jest-environment node
 *
 * LUM-1259: the local scan log's queries pin the workspace on every read and
 * write, match a repository only among the workspace's linked ones, dedupe
 * on (workspace, repo, commit, result), and find a PR head's local history
 * by sha or by patch-id (an amended / rebased commit). Plus the history
 * view: matched-by, "flagged locally at <sha> and pushed anyway", LOCAL.
 */
jest.mock('@/lib/db/workspace-scope', () => ({
  scopedPrisma: {
    projectRepository: { findMany: jest.fn() },
    localScanRun: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
  },
}))

import { Prisma } from '@prisma/client'
import { scopedPrisma } from '@/lib/db/workspace-scope'
import {
  localScanLogRepository,
  type LocalScanRunRow,
} from '@/ee/security/repositories/local-scan-log.repository'
import {
  localScanLogService,
  toLocalHistory,
} from '@/ee/security/services/local-scan-log.service'
import { fakeAwsKeyId } from '@/cli/test-support/fake-secrets'

const m = <T>(fn: T) => fn as unknown as jest.Mock
const HEAD = '1'.repeat(40)
const OLD = '2'.repeat(40)
const OTHER = '3'.repeat(40)

beforeEach(() => jest.clearAllMocks())

function row(over: Partial<LocalScanRunRow> = {}): LocalScanRunRow {
  return {
    id: 'r',
    commitSha: HEAD,
    patchId: 'p1',
    branch: 'feature',
    actor: 'USER',
    trigger: 'POST_COMMIT',
    scanners: ['SECRETS'],
    findingCount: 0,
    scannedAt: new Date('2026-10-19T12:00:00Z'),
    createdAt: new Date('2026-10-19T12:00:01Z'),
    findings: [],
    ...over,
  }
}

describe('findLinkedRepo', () => {
  it('matches among the workspace’s linked repositories, exact case-folded', async () => {
    m(scopedPrisma.projectRepository.findMany).mockResolvedValue([
      { fullName: 'Acme/A_p' },
      { fullName: 'Acme/App' },
    ])
    expect(
      await localScanLogRepository.findLinkedRepo('ws_1', 'acme/app')
    ).toBe('Acme/App')
    const arg = m(scopedPrisma.projectRepository.findMany).mock.calls[0][0]
    expect(arg.where).toEqual({
      fullName: { equals: 'acme/app', mode: 'insensitive' },
      project: { workspaceId: 'ws_1' },
    })
  })

  it('is null for a repository of no project of this workspace', async () => {
    m(scopedPrisma.projectRepository.findMany).mockResolvedValue([])
    expect(
      await localScanLogRepository.findLinkedRepo('ws_1', 'other/repo')
    ).toBeNull()
  })
})

describe('create / findByResultKey', () => {
  it('looks a rerun up by the workspace-pinned unique key', async () => {
    m(scopedPrisma.localScanRun.findUnique).mockResolvedValue({ id: 'r1' })
    await localScanLogRepository.findByResultKey('ws_1', 'A/b', HEAD, 'k')
    expect(m(scopedPrisma.localScanRun.findUnique).mock.calls[0][0]).toEqual({
      where: {
        workspaceId_repo_commitSha_resultKey: {
          workspaceId: 'ws_1',
          repo: 'A/b',
          commitSha: HEAD,
          resultKey: 'k',
        },
      },
      select: { id: true },
    })
  })

  it('writes the run with its findings, and reads a unique-key race as null', async () => {
    m(scopedPrisma.localScanRun.create).mockResolvedValueOnce({ id: 'r1' })
    const input = {
      workspaceId: 'ws_1',
      repo: 'A/b',
      commitSha: HEAD,
      parentSha: null,
      patchId: null,
      branch: null,
      sessionId: null,
      taskId: null,
      actor: 'USER' as const,
      memberId: 'm_1',
      trigger: 'MANUAL' as const,
      scanners: ['SECRETS'],
      scannerVersion: 'secrets@1',
      cliVersion: null,
      filesScanned: 0,
      findingCount: 0,
      resultKey: 'k',
      scannedAt: new Date(0),
      findings: [],
    }
    expect(await localScanLogRepository.create(input)).toEqual({ id: 'r1' })
    const data = m(scopedPrisma.localScanRun.create).mock.calls[0][0].data
    expect(data.workspaceId).toBe('ws_1')
    expect(data.findings).toEqual({ create: [] })

    m(scopedPrisma.localScanRun.create).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      })
    )
    expect(await localScanLogRepository.create(input)).toBeNull()
  })
})

describe('findHistoryForCommit', () => {
  it('finds the head by sha, then every commit sharing its patch-id', async () => {
    m(scopedPrisma.localScanRun.findMany)
      .mockResolvedValueOnce([{ patchId: 'p1' }, { patchId: null }])
      .mockResolvedValueOnce([row()])
    await localScanLogRepository.findHistoryForCommit(
      'ws_1',
      ['Acme/App'],
      HEAD,
      20
    )
    const [first, second] = m(scopedPrisma.localScanRun.findMany).mock.calls
    expect(first[0].where).toEqual({
      workspaceId: 'ws_1',
      repo: { in: ['Acme/App'] },
      commitSha: HEAD,
    })
    expect(second[0].where).toEqual({
      workspaceId: 'ws_1',
      repo: { in: ['Acme/App'] },
      OR: [{ commitSha: HEAD }, { patchId: { in: ['p1'] } }],
    })
    expect(second[0].orderBy).toEqual({ scannedAt: 'desc' })
    expect(second[0].take).toBe(20)
  })

  it('reads nothing for a repository with no logged run', async () => {
    expect(
      await localScanLogRepository.findHistoryForCommit('ws_1', [], HEAD, 20)
    ).toEqual([])
    expect(scopedPrisma.localScanRun.findMany).not.toHaveBeenCalled()
  })
})

describe('the local history view', () => {
  it('flags the commits whose latest run had findings, and says how each matched', () => {
    const view = toLocalHistory(HEAD, [
      row({ commitSha: HEAD, findingCount: 0 }),
      row({ commitSha: OLD, findingCount: 2, scannedAt: new Date(1) }),
      row({ commitSha: OLD, findingCount: 0, scannedAt: new Date(0) }),
    ])
    expect(view).toMatchObject({ source: 'LOCAL', headSha: HEAD })
    expect(view!.runs.map(r => r.matchedBy)).toEqual([
      'sha',
      'patch-id',
      'patch-id',
    ])
    expect(view!.flaggedAt).toEqual([OLD])
  })

  it('is null when nothing matches', () => {
    expect(toLocalHistory(HEAD, [])).toBeNull()
  })

  it('redacts a stored title on the way out too', () => {
    const key = fakeAwsKeyId()
    const view = toLocalHistory(HEAD, [
      row({
        findingCount: 1,
        findings: [
          {
            scanner: 'SECRETS',
            fingerprint: 'f',
            ruleId: 'r',
            severity: 'HIGH',
            filePath: 'a.ts',
            line: 1,
            title: `key ${key}`,
            label: null,
          },
        ],
      }),
    ])
    expect(JSON.stringify(view)).not.toContain(key)
  })

  it('historyForHead reads by the stored spellings, and a failed read is no history', async () => {
    m(scopedPrisma.localScanRun.groupBy).mockResolvedValue([
      { repo: 'Acme/App' },
      { repo: 'Acme/A_p' },
    ])
    m(scopedPrisma.localScanRun.findMany)
      .mockResolvedValueOnce([{ patchId: null }])
      .mockResolvedValueOnce([row({ findingCount: 1 })])
    const view = await localScanLogService.historyForHead(
      'ws_1',
      'acme/app',
      HEAD
    )
    expect(view!.flaggedAt).toEqual([HEAD])
    expect(
      m(scopedPrisma.localScanRun.findMany).mock.calls[0][0].where.repo
    ).toEqual({ in: ['Acme/App'] })

    expect(
      await localScanLogService.historyForHead('ws_1', 'acme/app', null)
    ).toBeNull()

    jest.spyOn(console, 'warn').mockImplementation(() => {})
    m(scopedPrisma.localScanRun.groupBy).mockRejectedValueOnce(new Error('db'))
    expect(
      await localScanLogService.historyForHead('ws_1', 'acme/app', OTHER)
    ).toBeNull()
  })
})
