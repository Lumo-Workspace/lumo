/**
 * @jest-environment node
 *
 * LUM-963 multi-tenant: a human may widen a FALSE_POSITIVE suppression rule
 * from one path to its whole directory — SENSITIVE_PATH_READ only, never over
 * `/`, `~` or a top-level directory — so a workspace that legitimately reads
 * e.g. `/etc/sudoers.d/*` can quiet that noise in one ruling. Routes run
 * against the REAL service with repositories mocked.
 */
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/tasks/[id]/boundary-crossings/disposition/route'
import { GET as PREVIEW } from '@/app/api/tasks/[id]/boundary-crossings/[crossingId]/suppression-preview/route'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { crossingSuppressionRuleRepository } from '@/lib/repositories/crossing-suppression-rule.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import {
  matchesSuppressionTarget,
  suppressionDirectory,
  suppressionPatternFor,
} from '@/lib/boundary-crossing/suppression'
import { dispositionBoundaryCrossingSchema } from '@/lib/validation/boundary-crossing'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/api/resolve-task-param', () => ({
  resolveTaskParam: jest.fn(),
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findById: jest.fn(),
    findAllByTask: jest.fn(),
    listExplanationsByCrossingIds: jest.fn(() => []),
    disposition: jest.fn(),
    setRemediationTask: jest.fn(),
    countRetroactiveSuppressionCandidates: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/crossing-suppression-rule.repository', () => ({
  crossingSuppressionRuleRepository: {
    // LUM-759: creating/revoking a rule also applies/undoes it on the existing
    // crossings, in one transaction — so these replaced the bare create/revoke.
    createWithRetroactiveSweep: jest.fn(),
    findById: jest.fn(),
    revokeWithRestore: jest.fn(),
    findActiveForProject: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    create: jest.fn(),
    listDispositionChangesByTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(async () => ({ id: 'actor-1' })),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findWithProject: jest.fn(), findHeaderById: jest.fn() },
}))
jest.mock('@/lib/services/task-creation.service', () => ({
  createTask: jest.fn(),
}))
jest.mock('@/lib/services/task-dependency.service', () => ({
  taskDependencyService: { addManual: jest.fn() },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    findManyByIdsForEditChange: jest.fn(),
    findTurnSummariesForSessions: jest.fn(),
    findManyByIdsForAttribution: jest.fn(),
    findTurnUsageForSessions: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findManyForAttribution: jest.fn() },
}))

const mockIdentity = requireIdentity as jest.Mock
const findById = boundaryCrossingRepository.findById as jest.Mock
const disposition = boundaryCrossingRepository.disposition as jest.Mock
const countCandidates =
  boundaryCrossingRepository.countRetroactiveSuppressionCandidates as jest.Mock
const ruleCreate =
  crossingSuppressionRuleRepository.createWithRetroactiveSweep as jest.Mock

const CLERK = {
  clerkId: 'clerk-1',
  memberId: 'member-1',
  workspaceId: 'w-1',
  source: 'clerk' as const,
}
const read = (target: string, over: Record<string, unknown> = {}) => ({
  id: 'bc-1',
  taskId: 't-1',
  category: 'SENSITIVE_PATH_READ',
  detail: `read sensitive path ${target} — advisory`,
  target,
  severity: 'LOW',
  advisory: true,
  disposition: null,
  ...over,
})
const post = (body: unknown) =>
  POST({ json: async () => body, headers: { get: () => null } } as never, {
    params: Promise.resolve({ id: 'LUM-963' }),
  })
const preview = (query = '') =>
  PREVIEW(
    new NextRequest(
      `http://localhost/api/tasks/LUM-963/boundary-crossings/bc-1/suppression-preview${query}`
    ),
    { params: Promise.resolve({ id: 'LUM-963', crossingId: 'bc-1' }) }
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(CLERK)
  ;(resolveTaskParam as jest.Mock).mockResolvedValue({ id: 't-1' })
  ;(taskRepository.findWithProject as jest.Mock).mockResolvedValue({
    id: 't-1',
    projectId: 'p-1',
  })
  ruleCreate.mockResolvedValue({
    id: 'rule-1',
    suppressedCount: 3,
    capped: false,
  })
  disposition.mockResolvedValue({ count: 1 })
  countCandidates.mockResolvedValue(12)
})

describe('suppressionDirectory / suppressionPatternFor', () => {
  it.each([
    ['/etc/sudoers.d/50-x', '/etc/sudoers.d'],
    ['~/.ssh/id_rsa', '~/.ssh'],
    ['~/.config/gh/hosts.yml', '~/.config/gh'],
    ['/opt/configs/api_tokens.json', '/opt/configs'],
  ])('%s → %s', (target, dir) => {
    expect(suppressionDirectory('SENSITIVE_PATH_READ', target)).toBe(dir)
    expect(
      suppressionPatternFor('SENSITIVE_PATH_READ', target, 'directory')
    ).toBe(`${dir}/*`)
  })

  it.each([
    '/etc/shadow',
    '/etc/sudoers',
    '~/.netrc',
    '~/.ssh',
    '/shadowfile',
    'x',
  ])('%s → refused (/, ~ or a top-level directory)', target => {
    expect(suppressionDirectory('SENSITIVE_PATH_READ', target)).toBeNull()
    expect(
      suppressionPatternFor('SENSITIVE_PATH_READ', target, 'directory')
    ).toBeNull()
  })

  it('other categories have no directory scope; exact stays exact', () => {
    expect(
      suppressionDirectory('SENSITIVE_PATH_EDIT', 'lib/auth/x.ts')
    ).toBeNull()
    expect(
      suppressionDirectory('PROJECT_RULE_VIOLATION', 'actionrule:r1')
    ).toBeNull()
    expect(
      suppressionPatternFor('PROJECT_RULE_VIOLATION', 'rm -rf a/*', 'exact')
    ).toBe('rm -rf a/\\*')
  })

  it('the directory pattern covers files below it and nothing beside it', () => {
    const p = suppressionPatternFor(
      'SENSITIVE_PATH_READ',
      '/etc/sudoers.d/50-x',
      'directory'
    )!
    expect(matchesSuppressionTarget(p, '/etc/sudoers.d/90-cloud')).toBe(true)
    expect(matchesSuppressionTarget(p, '/etc/sudoers')).toBe(false)
    expect(matchesSuppressionTarget(p, '/etc/shadow')).toBe(false)
  })
})

describe('disposition route', () => {
  it('a directory-scoped FALSE_POSITIVE creates a prefix rule over the directory', async () => {
    findById.mockResolvedValue(read('/etc/sudoers.d/50-x'))
    const res = await post({
      crossingId: 'bc-1',
      disposition: 'FALSE_POSITIVE',
      suppressSimilarInProject: true,
      suppressionScope: 'directory',
      suppressionReason: 'sysadmin workspace',
    })
    expect(res.status).toBe(200)
    expect(ruleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p-1',
        category: 'SENSITIVE_PATH_READ',
        targetPattern: '/etc/sudoers.d/*',
      }),
      expect.anything()
    )
  })

  it('without a scope the rule stays exact (unchanged behaviour)', async () => {
    findById.mockResolvedValue(read('/etc/sudoers.d/50-x'))
    await post({
      crossingId: 'bc-1',
      disposition: 'FALSE_POSITIVE',
      suppressSimilarInProject: true,
    })
    expect(ruleCreate).toHaveBeenCalledWith(
      expect.objectContaining({ targetPattern: '/etc/sudoers.d/50-x' }),
      expect.anything()
    )
  })

  it.each([
    ['a too-broad directory', read('/etc/shadow')],
    [
      'a non-path category',
      read('actionrule:r1', { category: 'PROJECT_RULE_VIOLATION' }),
    ],
  ])(
    '%s is refused 422 with no rule and no disposition',
    async (_, crossing) => {
      findById.mockResolvedValue(crossing)
      const res = await post({
        crossingId: 'bc-1',
        disposition: 'FALSE_POSITIVE',
        suppressSimilarInProject: true,
        suppressionScope: 'directory',
      })
      expect(res.status).toBe(422)
      expect(ruleCreate).not.toHaveBeenCalled()
      expect(disposition).not.toHaveBeenCalled()
    }
  )

  it('the bearer (agent/CLI) path stays closed for the new field too', async () => {
    mockIdentity.mockResolvedValue({ ...CLERK, source: 'bearer' })
    const res = await post({
      crossingId: 'bc-1',
      disposition: 'FALSE_POSITIVE',
      suppressSimilarInProject: true,
      suppressionScope: 'directory',
    })
    expect(res.status).toBe(403)
    expect(ruleCreate).not.toHaveBeenCalled()
  })

  it('the schema only accepts exact | directory', () => {
    const base = { crossingId: 'c', disposition: 'FALSE_POSITIVE' }
    expect(
      dispositionBoundaryCrossingSchema.safeParse({
        ...base,
        suppressionScope: 'directory',
      }).success
    ).toBe(true)
    expect(
      dispositionBoundaryCrossingSchema.safeParse({
        ...base,
        suppressionScope: 'everything',
      }).success
    ).toBe(false)
  })
})

describe('suppression-preview route', () => {
  it("previews the directory rule's blast radius with the same prefix pattern", async () => {
    findById.mockResolvedValue(read('/etc/sudoers.d/50-x'))
    const res = await preview('?scope=directory')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ suppressible: true, count: 12 })
    expect(countCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        targetPattern: '/etc/sudoers.d/*',
        category: 'SENSITIVE_PATH_READ',
      })
    )
  })

  it('no scope = exact pattern; an unbuildable directory reads as not suppressible', async () => {
    findById.mockResolvedValue(read('/etc/sudoers.d/50-x'))
    await preview()
    expect(countCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ targetPattern: '/etc/sudoers.d/50-x' })
    )
    findById.mockResolvedValue(read('/etc/shadow'))
    const res = await preview('?scope=directory')
    expect(await res.json()).toMatchObject({ suppressible: false, count: 0 })
  })

  it('a bad scope is 400', async () => {
    findById.mockResolvedValue(read('/etc/sudoers.d/50-x'))
    expect((await preview('?scope=all')).status).toBe(400)
  })
})
