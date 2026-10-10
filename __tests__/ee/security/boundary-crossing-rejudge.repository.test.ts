/**
 * @jest-environment node
 *
 * LUM-1064: plugin half of __tests__/boundary-crossing-rejudge.repository.test.ts (split)
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
  getRepoToken: jest.fn().mockResolvedValue('tok'),
}))

import { projectPolicyRepository } from '@/ee/security/repositories/project-policy.repository'

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([])
  updateMany.mockReset().mockResolvedValue({ count: 1 })
  policyFindMany.mockReset().mockResolvedValue([])
  prFindMany.mockReset().mockResolvedValue([])
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
