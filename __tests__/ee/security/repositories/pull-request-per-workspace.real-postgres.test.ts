/**
 * @jest-environment node
 *
 * LUM-924 — a pull request row is unique per workspace, not globally, so
 * workspaces sharing a GitHub App installation can each track the same PR.
 * Against a REAL Postgres (every migration replayed into PGlite): only the
 * database can say what the unique index actually accepts.
 *
 * LUM-1064: plugin half of __tests__/repositories/pull-request-per-workspace.real-postgres.test.ts (split)
 */
import { createPgliteHarness } from '../../../../scripts/test-support/pglite-harness'

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
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'

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

it('knows when another workspace holds the same PR', async () => {
  const solo = await githubRepository.upsertPullRequest({
    ...prData('ws-a', 'solo'),
    number: 8,
  })
  expect(
    await prSecurityScanRepository.isPullRequestHeldElsewhere(solo.id)
  ).toBe(false)
  await githubRepository.upsertPullRequest({
    ...prData('ws-b', 'b'),
    number: 8,
  })
  expect(
    await prSecurityScanRepository.isPullRequestHeldElsewhere(solo.id)
  ).toBe(true)
})
