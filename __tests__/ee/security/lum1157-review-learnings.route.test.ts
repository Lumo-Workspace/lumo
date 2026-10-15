/**
 * @jest-environment node
 *
 * LUM-1157: GET /api/workspaces/me/security-scan/learnings through the real
 * service — pinned to the caller's workspace, optional `repo`, a malformed
 * `repo` is 400, a learning with no project is listed (inProject false), and one
 * whose content is unreadable is listed rather than dropped.
 */
jest.mock('@/lib/auth/identity', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/ee/security/repositories/pr-review-learning.repository', () => ({
  prReviewLearningRepository: { listActiveForWorkspace: jest.fn() },
}))

import { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { prReviewLearningRepository } from '@/ee/security/repositories/pr-review-learning.repository'
import { GET } from '@/app/api/workspaces/me/security-scan/learnings/route'

const m = <T>(fn: T) => fn as unknown as jest.Mock
const list = m(prReviewLearningRepository.listActiveForWorkspace)
const URL = 'http://localhost/api/workspaces/me/security-scan/learnings'

beforeEach(() => {
  jest.clearAllMocks()
  m(requireIdentity).mockResolvedValue({
    clerkId: 'u_1',
    memberId: 'm_1',
    workspaceId: 'ws_1',
    workspaceSlug: 'acme',
    workspaceName: 'Acme',
    source: 'bearer',
  })
  list.mockResolvedValue([
    {
      memoryId: 'mem-1',
      repo: 'acme/unlinked',
      pathGlob: null,
      ruleId: 'judge:x',
      authorLogin: 'alice',
      repoWideAt: null,
      createdAt: new Date('2026-10-16T08:00:00Z'),
      projectId: null,
      content: { summary: 's', rule: 'Fake fixture tokens.', scope: 'x' },
    },
    {
      memoryId: 'mem-bad',
      repo: 'acme/app',
      pathGlob: null,
      ruleId: 'judge:y',
      authorLogin: 'bob',
      repoWideAt: null,
      createdAt: new Date('2026-10-15T08:00:00Z'),
      projectId: 'p1',
      content: { not: 'a convention' },
    },
  ])
})

it('lists the workspace learnings, a project-less and an unreadable one included', async () => {
  const res = await GET(new NextRequest(URL))
  expect(res.status).toBe(200)
  expect(list).toHaveBeenCalledWith('ws_1', null, 200)
  await expect(res.json()).resolves.toEqual({
    learnings: [
      {
        id: 'mem-1',
        repo: 'acme/unlinked',
        pathGlob: null,
        learning: 'Fake fixture tokens.',
        ruleId: 'judge:x',
        authorLogin: 'alice',
        repositoryWide: false,
        inProject: false,
        createdAt: '2026-10-16T08:00:00.000Z',
      },
      // Unreadable content is still listed (deletable), not dropped.
      {
        id: 'mem-bad',
        repo: 'acme/app',
        pathGlob: null,
        learning: '(content not readable as a learning)',
        ruleId: 'judge:y',
        authorLogin: 'bob',
        repositoryWide: false,
        inProject: true,
        createdAt: '2026-10-15T08:00:00.000Z',
      },
    ],
  })
})

it('?repo narrows to one repository', async () => {
  await GET(new NextRequest(`${URL}?repo=acme/unlinked`))
  expect(list).toHaveBeenCalledWith('ws_1', 'acme/unlinked', 200)
})

it('a malformed repo is 400 and reads nothing', async () => {
  const res = await GET(new NextRequest(`${URL}?repo=nope`))
  expect(res.status).toBe(400)
  expect(list).not.toHaveBeenCalled()
})
