/**
 * @jest-environment node
 *
 * LUM-924 — a pull request row is unique per workspace, not globally, so
 * workspaces sharing a GitHub App installation can each track the same PR.
 * Against a REAL Postgres (every migration replayed into PGlite): only the
 * database can say what the unique index actually accepts.
 */
// LUM-1064: plugin cases live in __tests__/ee/security/repositories/pull-request-per-workspace.real-postgres.test.ts.
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'

// jest.setup.js mocks PrismaClient globally; this suite needs the real one.
const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))

import { githubRepository } from '@/lib/repositories/github.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

jest.setTimeout(180_000)

const REPO = 'acme-inc/web'

function prData(workspaceId: string, title: string) {
  return {
    workspaceId,
    taskId: null,
    integrationId: null,
    repo: REPO,
    number: 7,
    title,
    url: `https://github.com/${REPO}/pull/7`,
    state: 'open',
    authorLogin: 'octo',
    headBranch: 'feature',
    baseBranch: 'main',
    isDraft: false,
    mergedAt: null,
    closedAt: null,
  }
}

beforeAll(async () => {
  await harness.start()
  for (const id of ['ws-a', 'ws-b']) {
    await harness.prisma!.workspace.create({
      data: { id, name: id, slug: id },
    })
  }
})

afterAll(async () => {
  await harness.stop()
})

it('one pull request row per workspace for the same repo and number', async () => {
  const a = await githubRepository.upsertPullRequest(prData('ws-a', 'A'))
  const b = await githubRepository.upsertPullRequest(prData('ws-b', 'B'))
  expect(a.id).not.toBe(b.id)

  // A redelivery for ws-b updates ws-b's row and leaves ws-a's alone.
  const b2 = await githubRepository.upsertPullRequest(prData('ws-b', 'B v2'))
  expect(b2.id).toBe(b.id)
  expect(
    (await pullRequestRepository.findByRepoAndNumber('ws-a', REPO, 7))?.title
  ).toBe('A')
  expect(
    (await pullRequestRepository.findByRepoAndNumber('ws-b', REPO, 7))?.title
  ).toBe('B v2')
  expect(
    (await pullRequestRepository.findAllByRepoAndNumber(REPO, 7)).map(
      r => r.workspaceId
    )
  ).toEqual(['ws-a', 'ws-b'])

  // The same workspace still cannot hold the PR twice.
  const { workspaceId, repo, number, title, url, state, authorLogin } = prData(
    'ws-a',
    'dup'
  )
  await expect(
    harness.prisma!.pullRequest.create({
      data: {
        workspaceId,
        repo,
        number,
        title,
        url,
        state,
        authorLogin,
        headBranch: 'feature',
        baseBranch: 'main',
      },
    })
  ).rejects.toMatchObject({ code: 'P2002' })
})
