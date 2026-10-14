/**
 * @jest-environment node
 *
 * LUM-1133 — the repository behind the task-less review decision: repository
 * names match case-insensitively, settings are read per workspace list, and
 * "linked elsewhere" only looks at OTHER workspaces' task-linked rows.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    gitHubAppInstallation: { findMany: jest.fn() },
    repositoryReviewSetting: { findMany: jest.fn(), upsert: jest.fn() },
    pullRequest: { findFirst: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { repoReviewSettingRepository } from '@/ee/security/repositories/repo-review-setting.repository'

const db = prisma as unknown as {
  gitHubAppInstallation: { findMany: jest.Mock }
  repositoryReviewSetting: { findMany: jest.Mock; upsert: jest.Mock }
  pullRequest: { findFirst: jest.Mock }
}

beforeEach(() => jest.clearAllMocks())

it('findConfirmingWorkspaces matches the repository case-insensitively', async () => {
  const t = new Date('2026-01-01')
  db.gitHubAppInstallation.findMany.mockResolvedValue([
    { workspaceId: 'a', repositories: ['Acme/App'], createdAt: t },
    { workspaceId: 'b', repositories: ['acme/other'], createdAt: t },
  ])
  await expect(
    repoReviewSettingRepository.findConfirmingWorkspaces('acme/app')
  ).resolves.toEqual([{ workspaceId: 'a', confirmedAt: t }])
})

it('findSettings reads only the given workspaces, and none for an empty list', async () => {
  await expect(
    repoReviewSettingRepository.findSettings([], 'acme/app')
  ).resolves.toEqual([])
  expect(db.repositoryReviewSetting.findMany).not.toHaveBeenCalled()
  db.repositoryReviewSetting.findMany.mockResolvedValue([])
  await repoReviewSettingRepository.findSettings(['a', 'b'], 'acme/app')
  expect(db.repositoryReviewSetting.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { workspaceId: { in: ['a', 'b'] }, repo: 'acme/app' },
    })
  )
})

it('upsert keys on (workspaceId, repo)', async () => {
  db.repositoryReviewSetting.upsert.mockResolvedValue({})
  await repoReviewSettingRepository.upsert('a', 'acme/app', {
    autoReview: false,
    reviewDrafts: true,
  })
  expect(db.repositoryReviewSetting.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { workspaceId_repo: { workspaceId: 'a', repo: 'acme/app' } },
      create: {
        workspaceId: 'a',
        repo: 'acme/app',
        autoReview: false,
        reviewDrafts: true,
      },
    })
  )
})

it('isLinkedElsewhere looks for another workspace holding the PR on a task', async () => {
  db.pullRequest.findFirst.mockResolvedValue({ id: 'x' })
  await expect(
    repoReviewSettingRepository.isLinkedElsewhere('a', 'acme/app', 7)
  ).resolves.toBe(true)
  expect(db.pullRequest.findFirst).toHaveBeenCalledWith({
    where: {
      workspaceId: { not: 'a' },
      repo: { equals: 'acme/app', mode: 'insensitive' },
      number: 7,
      taskId: { not: null },
    },
    select: { id: true },
  })
  db.pullRequest.findFirst.mockResolvedValue(null)
  await expect(
    repoReviewSettingRepository.isLinkedElsewhere('a', 'acme/app', 7)
  ).resolves.toBe(false)
})
