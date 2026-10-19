/**
 * @jest-environment node
 *
 * LUM-1143 — the auto-review filter migration against a REAL Postgres
 * replayed from every migration: additive only; every repository connected
 * before it (stored row or not) keeps "all branches" for an empty
 * base-branch list, and a repository connected afterwards gets "default
 * branch only" — read back through the real repository and decision.
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { createPgliteHarness } from '../../../scripts/test-support/pglite-harness'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const migration = '20261113090000_lum1143_review_filters'
const harness = createPgliteHarness(PrismaClient, {
  stopBeforeMigration: migration,
})

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))
jest.mock('@/ee/security/services/pr-security-scan-dispatch', () => ({
  dispatchPrSecurityScan: jest.fn(),
  shouldScanOnPrEvent: jest.requireActual(
    '@/ee/security/services/pr-security-scan-dispatch'
  ).shouldScanOnPrEvent,
}))

import { decideTasklessReview } from '@/ee/security/services/pr-auto-review.service'

jest.setTimeout(180_000)

type Row = {
  workspaceId: string
  repo: string
  autoReview: boolean
  emptyBaseBranchesMeans: string
  baseBranches: string[]
}

beforeAll(async () => {
  await harness.start()
  await harness.insert('workspaces', { id: 'ws', name: 'ws', slug: 'ws' })
  await harness.insert('github_app_installations', {
    id: 'inst',
    workspaceId: 'ws',
    installationId: 1143,
    repositories: ['Acme/Old', 'acme/configured'],
  })
  // A repository the owner had already configured (LUM-1133).
  await harness.query(
    `insert into repository_review_settings (id, "workspaceId", repo, "autoReview", "reviewDrafts", "updatedAt") values ('rrs1', 'ws', 'acme/configured', false, true, now())`
  )
  await harness.applyMigration(migration)
  const dir = path.resolve(__dirname, '../../../prisma/migrations')
  const later = readdirSync(dir)
    .filter(d => /^\d{14}_/.test(d) && d > migration)
    .sort()
  if (later.length > 0) await harness.applyMigrationsFrom(later[0]!)
})
afterAll(async () => harness.stop())

const rows = () =>
  harness.query<Row>(
    `select "workspaceId", repo, "autoReview", "emptyBaseBranchesMeans", "baseBranches" from repository_review_settings order by repo`
  )

const event = (repo: string, baseBranch: string) => ({
  workspaceId: 'ws',
  pullRequestId: 'pr',
  action: 'opened',
  state: 'open',
  repo,
  prNumber: 1,
  isDraft: false,
  reviewFacts: {
    baseBranch,
    defaultBranch: 'main',
    labels: [],
    title: 't',
    body: null,
    authorLogin: 'alice',
  },
})

it('backfills every repository connected before the migration to all_branches, keeping existing settings', async () => {
  expect(await rows()).toEqual([
    {
      workspaceId: 'ws',
      repo: 'acme/configured',
      autoReview: false,
      emptyBaseBranchesMeans: 'all_branches',
      baseBranches: [],
    },
    {
      workspaceId: 'ws',
      repo: 'acme/old',
      autoReview: true,
      emptyBaseBranchesMeans: 'all_branches',
      baseBranches: [],
    },
  ])
})

it('an existing repository still auto-reviews a PR into a non-default base', async () => {
  await expect(
    decideTasklessReview(event('Acme/Old', 'feature/stacked'))
  ).resolves.toEqual({ review: true })
})

it('a repository connected after the migration reviews only default-branch PRs', async () => {
  await harness.query(
    `update github_app_installations set repositories = array_append(repositories, 'acme/new') where id = 'inst'`
  )
  await expect(
    decideTasklessReview(event('acme/new', 'feature/stacked'))
  ).resolves.toEqual({ review: false, reason: 'base_branch' })
  await expect(
    decideTasklessReview(event('acme/new', 'main'))
  ).resolves.toEqual({ review: true })
  // A row created later (an owner's first change) takes the column default.
  await harness.query(
    `insert into repository_review_settings (id, "workspaceId", repo, "updatedAt") values ('rrs2', 'ws', 'acme/new', now())`
  )
  const created = (await rows()).find(r => r.repo === 'acme/new')
  expect(created?.emptyBaseBranchesMeans).toBe('default_branch_only')
})

it('re-running the backfill insert is a no-op (unique on workspace + repo)', async () => {
  const before = (await rows()).length
  await harness.query(
    `insert into repository_review_settings (id, "workspaceId", repo, "emptyBaseBranchesMeans", "createdAt", "updatedAt")
     select 'lum1143_' || md5(c."workspaceId" || '/' || c."repo"), c."workspaceId", c."repo", 'all_branches', now(), now()
     from (select distinct i."workspaceId", lower(r) as "repo" from github_app_installations i, unnest(i."repositories") as r) c
     on conflict ("workspaceId", "repo") do nothing`
  )
  expect((await rows()).length).toBe(before)
})
