/**
 * @jest-environment node
 *
 * LUM-780 — the re-judge's data layer, asserted at the query-shape level:
 * the read selects exactly the rows the DONE gate counts, the write repeats
 * that predicate as its WHERE and never carries a `disposition` key, and the
 * GitHub file-list reader fails closed (throws) rather than returning a
 * partial list.
 */
const findMany = jest.fn()
const updateMany = jest.fn()
const policyFindMany = jest.fn()
const prFindMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    boundaryCrossing: {
      findMany: (...a: unknown[]) => findMany(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
    },
    projectPolicy: { findMany: (...a: unknown[]) => policyFindMany(...a) },
    pullRequest: { findMany: (...a: unknown[]) => prFindMany(...a) },
  },
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn().mockResolvedValue('tok'),
}))

import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { projectPolicyRepository } from '@/lib/repositories/project-policy.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { fetchPrFiles } from '@/lib/integrations/github/contents'

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([])
  updateMany.mockReset().mockResolvedValue({ count: 1 })
  policyFindMany.mockReset().mockResolvedValue([])
  prFindMany.mockReset().mockResolvedValue([])
})

describe('boundaryCrossingRepository.findOpenBlockingRejudgeable', () => {
  it('selects only OPEN + blocking + task-scoped rows of the given categories (the gate predicate)', async () => {
    await boundaryCrossingRepository.findOpenBlockingRejudgeable({
      categories: ['POLICY_WEAKENING', 'TEST_FILE_DELETED'],
      take: 50,
    })
    const arg = findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>
      take: number
    }
    expect(arg.where).toEqual({
      category: { in: ['POLICY_WEAKENING', 'TEST_FILE_DELETED'] },
      disposition: null,
      advisory: false,
      taskId: { not: null },
    })
    expect(arg.take).toBe(50)
  })

  it('narrows to one task or one project when asked', async () => {
    await boundaryCrossingRepository.findOpenBlockingRejudgeable({
      categories: ['TEST_FILE_DELETED'],
      taskId: 't1',
      take: 10,
    })
    expect(
      (findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where
    ).toMatchObject({ taskId: 't1', disposition: null, advisory: false })

    await boundaryCrossingRepository.findOpenBlockingRejudgeable({
      categories: ['POLICY_WEAKENING'],
      projectId: 'p1',
      take: 10,
    })
    expect(
      (findMany.mock.calls[1]?.[0] as { where: Record<string, unknown> }).where
    ).toMatchObject({
      task: { projectId: 'p1' },
      taskId: { not: null },
      disposition: null,
      advisory: false,
    })
  })
})

describe('boundaryCrossingRepository.downgradeToAdvisory', () => {
  it('guards the write with the gate predicate and never writes a disposition', async () => {
    const now = new Date('2026-09-14T00:00:00Z')
    const count = await boundaryCrossingRepository.downgradeToAdvisory('c1', {
      severity: 'MEDIUM',
      detail: 'd',
      now,
    })
    expect(count).toBe(1)
    const arg = updateMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }
    expect(arg.where).toEqual({ id: 'c1', disposition: null, advisory: false })
    expect(arg.data).toEqual({
      advisory: true,
      severity: 'MEDIUM',
      detail: 'd',
      lastSeenAt: now,
    })
    expect(Object.keys(arg.data)).not.toContain('disposition')
    expect(Object.keys(arg.data)).not.toContain('dispositionedById')
  })

  it('reports 0 when the row was ruled on or downgraded in the meantime', async () => {
    updateMany.mockResolvedValue({ count: 0 })
    await expect(
      boundaryCrossingRepository.downgradeToAdvisory('c1', {
        severity: 'MEDIUM',
        detail: 'd',
        now: new Date(),
      })
    ).resolves.toBe(0)
  })
})

describe('projectPolicyRepository.findRuleTextByRef', () => {
  it('finds the rule text across the project policies newest-first, null when no policy carried the id', async () => {
    policyFindMany.mockResolvedValue([
      { rules: [{ id: 'aaaa', text: 'newer rule' }] },
      { rules: [{ id: 'bbbb', text: 'older rule' }] },
    ])
    await expect(
      projectPolicyRepository.findRuleTextByRef('p1', 'bbbb')
    ).resolves.toBe('older rule')
    await expect(
      projectPolicyRepository.findRuleTextByRef('p1', 'zzzz')
    ).resolves.toBeNull()
    expect(policyFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { projectId: 'p1' },
      orderBy: { compiledAt: 'desc' },
    })
  })
})

describe('pullRequestRepository.listRepoAndNumberByTask', () => {
  it('reads every PR of the task as (workspace, repo, number, state)', async () => {
    await pullRequestRepository.listRepoAndNumberByTask('t1')
    expect(prFindMany.mock.calls[0]?.[0]).toEqual({
      where: { taskId: 't1' },
      select: { workspaceId: true, repo: true, number: true, state: true },
      orderBy: { number: 'asc' },
    })
  })
})

describe('fetchPrFiles', () => {
  const ok = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response

  afterEach(() => jest.restoreAllMocks())

  it('paginates until a short page and returns filename + status', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      filename: `f${i}.ts`,
      status: 'modified',
      extra: 'ignored',
    }))
    const page2 = [{ filename: '__tests__/x.test.ts', status: 'removed' }]
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(ok(page1))
      .mockResolvedValueOnce(ok(page2))
    const files = await fetchPrFiles({
      workspaceId: 'w',
      fullName: 'o/r',
      prNumber: 7,
    })
    expect(files).toHaveLength(101)
    expect(files[100]).toEqual({
      filename: '__tests__/x.test.ts',
      status: 'removed',
    })
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      '/repos/o/r/pulls/7/files?per_page=100&page=1'
    )
    expect(String(fetchSpy.mock.calls[1]?.[0])).toContain('&page=2')
  })

  it('throws on a non-2xx (unreadable, never "nothing removed")', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    } as unknown as Response)
    await expect(
      fetchPrFiles({ workspaceId: 'w', fullName: 'o/r', prNumber: 7 })
    ).rejects.toThrow('403')
  })

  it('throws on a PR beyond the page cap instead of returning a partial list', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({
      filename: `f${i}.ts`,
      status: 'modified',
    }))
    jest.spyOn(global, 'fetch').mockResolvedValue(ok(full))
    await expect(
      fetchPrFiles({ workspaceId: 'w', fullName: 'o/r', prNumber: 7 })
    ).rejects.toThrow('more than 1000 files')
  })

  it('throws on a malformed entry', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(ok([{ filename: 'a.ts' }]))
    await expect(
      fetchPrFiles({ workspaceId: 'w', fullName: 'o/r', prNumber: 7 })
    ).rejects.toThrow('missing filename/status')
  })
})
