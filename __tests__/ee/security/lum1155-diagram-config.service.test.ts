/**
 * @jest-environment node
 *
 * LUM-1155 — what `@<app> diagram` reads NOW: whether diagrams are on and
 * the path filters, `.lumo.yaml` on the PR's base commit over the stored
 * setting over the default. Never throws.
 */
jest.mock('@/lib/integrations/github/contents', () => ({
  readRepoFile: jest.fn(),
  fetchPrBase: jest.fn(),
  fetchDefaultBranchHead: jest.fn(),
}))
jest.mock('@/ee/security/repositories/repo-review-setting.repository', () => ({
  repoReviewSettingRepository: {
    findReviewStyle: jest.fn(),
    findPathFilters: jest.fn(),
  },
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

import {
  clearRepoConfigCache,
  repoConfigService,
} from '@/ee/security/services/repo-config.service'
import * as gh from '@/lib/integrations/github/contents'
import { repoReviewSettingRepository } from '@/ee/security/repositories/repo-review-setting.repository'

const read = gh.readRepoFile as jest.Mock
const fetchPrBase = gh.fetchPrBase as jest.Mock
const style = repoReviewSettingRepository.findReviewStyle as jest.Mock
const filters = repoReviewSettingRepository.findPathFilters as jest.Mock

const input = { workspaceId: 'ws', repo: 'Acme/App', prNumber: 3 }

beforeEach(() => {
  jest.clearAllMocks()
  clearRepoConfigCache()
  fetchPrBase.mockResolvedValue({ sha: 'b'.repeat(40) })
  read.mockResolvedValue(null)
  style.mockResolvedValue({ sequenceDiagrams: false })
  filters.mockResolvedValue(['!docs/**'])
})

it('no file: the stored setting and filters', async () => {
  expect(
    await repoConfigService.sequenceDiagramSettingsForPullRequest(input)
  ).toEqual({ enabled: false, pathFilters: ['!docs/**'] })
})

it('the base commit file wins, key by key', async () => {
  read.mockResolvedValue(
    'reviews:\n  sequence_diagrams: true\n  path_filters: ["!gen/**"]\n'
  )
  expect(
    await repoConfigService.sequenceDiagramSettingsForPullRequest(input)
  ).toEqual({ enabled: true, pathFilters: ['!gen/**'] })
})

it('nothing stored and nothing readable: the defaults, never a throw', async () => {
  style.mockRejectedValue(new Error('db down'))
  fetchPrBase.mockRejectedValue(new Error('github down'))
  expect(
    await repoConfigService.sequenceDiagramSettingsForPullRequest(input)
  ).toEqual({ enabled: true, pathFilters: [] })
})
