/**
 * @jest-environment node
 *
 * LUM-1153 — `@<app> configuration` replies with the effective review
 * settings for the PR: every `.lumo.yaml` / repository key with its value
 * and source (LUM-1146's `repoConfigService.effective()`, run for real over
 * mocked GitHub reads), the workspace switches and the running layers. The
 * formatter is generic: keys it was never told about still appear. A
 * commenter without write access gets nothing.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/lib/integrations/github/collaborator-access', () => ({
  checkRepositoryWriteAccess: jest.fn(),
}))
jest.mock('@/lib/integrations/github/pr-comment-client', () => ({
  prCommentClient: {
    createIssueComment: jest.fn().mockResolvedValue({ id: 900 }),
    listIssueCommentsSince: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  readRepoFile: jest.fn(),
  fetchPrBase: jest.fn(),
  fetchDefaultBranchHead: jest.fn(),
}))
jest.mock('@/ee/security/repositories/repo-review-setting.repository', () => ({
  repoReviewSettingRepository: { findSettings: jest.fn() },
}))
jest.mock('@/ee/security/services/pr-review-control.service', () => ({
  prReviewControlService: { act: jest.fn() },
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findLatestByPullRequestIds: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findSecuritySwitches: jest.fn(),
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
    findAllowAuthorApproval: jest.fn().mockResolvedValue(true),
  },
}))
jest.mock('@/ee/security/repositories/pr-finding-thread.repository', () => ({
  prFindingThreadRepository: {
    findByPullRequest: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {},
}))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import {
  applyPrCommentCommand,
  buildHelpReply,
  type PrCommentEvent,
} from '@/ee/security/services/pr-command.service'
import { parsePrCommand } from '@/ee/security/services/pr-command-parse'
import { routeConversationComment } from '@/ee/security/security-scan/pr-chat'
import { prConfigurationService } from '@/ee/security/services/pr-configuration.service'
import { clearRepoConfigCache } from '@/ee/security/services/repo-config.service'
import {
  buildConfigurationReply,
  formatConfigValue,
  CONFIG_REPLY_MAX_ITEMS,
  type PrConfigurationView,
} from '@/ee/security/security-scan/pr-configuration-reply'
import { commandsBlock } from '@/ee/security/services/security-pr-review.service'
import { DEFAULT_WORKSPACE_SECURITY_SWITCHES } from '@/ee/security/security-scan/workspace-switches'
import { DEFAULT_REPO_REVIEW_SETTING } from '@/ee/security/security-scan/auto-review-policy'
import { REPO_CONFIG_FIELDS } from '@/ee/security/security-scan/repo-config'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { checkRepositoryWriteAccess } from '@/lib/integrations/github/collaborator-access'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import * as gh from '@/lib/integrations/github/contents'
import { repoReviewSettingRepository } from '@/ee/security/repositories/repo-review-setting.repository'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'

const access = checkRepositoryWriteAccess as jest.Mock
const reply = prCommentClient.createIssueComment as jest.Mock
const readFile = gh.readRepoFile as jest.Mock
const fetchPrBase = gh.fetchPrBase as jest.Mock
const fetchDefaultBranchHead = gh.fetchDefaultBranchHead as jest.Mock
const findSettings = repoReviewSettingRepository.findSettings as jest.Mock
const findSwitches = securityColumnsRepository.findSecuritySwitches as jest.Mock

const BASE_SHA = 'b'.repeat(40)
const OLD_SLUG = process.env.GITHUB_APP_SLUG

function event(body: string): PrCommentEvent {
  return {
    workspaceId: 'w1',
    pullRequestId: 'pr1',
    repo: 'acme/app',
    prNumber: 9,
    action: 'created',
    comment: {
      id: 555,
      body,
      createdAt: '2026-10-15T08:00:00Z',
      user: { login: 'alice', type: 'User' },
    },
    prAuthorLogin: 'bob',
  }
}

function replyBody(): string {
  return (reply.mock.calls[0]![0] as { body: string }).body
}

/** The table row of one key (`| \`key\` | value | source |`). */
function row(body: string, key: string): string {
  const line = body.split('\n').find(l => l.startsWith(`| \`${key}\` |`))
  if (!line) throw new Error(`no row for ${key}`)
  return line
}

beforeEach(() => {
  jest.clearAllMocks()
  clearRepoConfigCache()
  process.env.GITHUB_APP_SLUG = 'uselumo'
  ;(getRepoToken as jest.Mock).mockResolvedValue('token')
  access.mockResolvedValue('write')
  fetchPrBase.mockResolvedValue({ ref: 'main', sha: BASE_SHA })
  readFile.mockResolvedValue(
    'reviews:\n  auto_review:\n    drafts: true\n  path_filters: ["!docs/**"]\n'
  )
  findSettings.mockResolvedValue([
    {
      ...DEFAULT_REPO_REVIEW_SETTING,
      workspaceId: 'w1',
      ignoreUsernames: ['dependabot'],
    },
  ])
  findSwitches.mockResolvedValue({
    ...DEFAULT_WORKSPACE_SECURITY_SWITCHES,
    securityHuntEnabled: false,
  })
})

afterAll(() => {
  if (OLD_SLUG === undefined) delete process.env.GITHUB_APP_SLUG
  else process.env.GITHUB_APP_SLUG = OLD_SLUG
})

describe('parse + help', () => {
  test('`@uselumo configuration` is a command and is listed in help and the summary', () => {
    expect(parsePrCommand('@uselumo configuration', '@uselumo')).toEqual({
      command: 'configuration',
      text: 'configuration',
    })
    expect(buildHelpReply('@uselumo', null)).toContain(
      '`@uselumo configuration`'
    )
    expect(commandsBlock('@uselumo')).toContain('`@uselumo configuration`')
    // LUM-1154: a known command is never routed to the question answerer.
    expect(
      routeConversationComment(
        '@uselumo configuration',
        '@uselumo',
        parsePrCommand('@uselumo configuration', '@uselumo')
      )
    ).toBe('command')
  })
})

describe('@uselumo configuration (service)', () => {
  test('replies with every effective value and its source, read at the PR base', async () => {
    const outcome = await applyPrCommentCommand(event('@uselumo configuration'))
    expect(outcome).toBe('done')
    expect(reply).toHaveBeenCalledTimes(1)
    const body = replyBody()

    // Read at the PR's base commit, not its head.
    expect(fetchPrBase).toHaveBeenCalledWith({
      workspaceId: 'w1',
      fullName: 'acme/app',
      prNumber: 9,
    })
    expect(readFile).toHaveBeenCalledWith(
      expect.objectContaining({ ref: BASE_SHA, path: '.lumo.yaml' })
    )
    expect(body).toContain('`.lumo.yaml` on `main` at `bbbbbbb`: applied.')

    // Every registered key is listed (file > repository > default).
    for (const f of Object.values(REPO_CONFIG_FIELDS))
      expect(body).toContain(`| \`${f.key}\` |`)
    expect(row(body, 'reviews.auto_review.drafts')).toBe(
      '| `reviews.auto_review.drafts` | on | `.lumo.yaml` |'
    )
    expect(row(body, 'reviews.path_filters')).toBe(
      '| `reviews.path_filters` | `!docs/**` | `.lumo.yaml` |'
    )
    expect(row(body, 'reviews.auto_review.ignore_usernames')).toBe(
      '| `reviews.auto_review.ignore_usernames` | `dependabot` | repository settings |'
    )
    expect(row(body, 'reviews.auto_review.enabled')).toBe(
      '| `reviews.auto_review.enabled` | on | repository settings |'
    )

    // Workspace switches with their source; the layers that run.
    expect(row(body, 'huntEnabled')).toBe(
      '| `huntEnabled` | off | workspace setting |'
    )
    expect(row(body, 'scanEnabled')).toBe('| `scanEnabled` | on | default |')
    expect(body).toMatch(/Running on this deployment: .*hunt: off/)
    // The reply carries its redelivery marker.
    expect(body).toContain('<!-- lumo-command:ack:555:')
  })

  test('a commenter without write access is ignored: no reply, nothing read', async () => {
    access.mockResolvedValue('read')
    const outcome = await applyPrCommentCommand(event('@uselumo configuration'))
    expect(outcome).toBe('unauthorized')
    expect(reply).not.toHaveBeenCalled()
    expect(fetchPrBase).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
    expect(findSwitches).not.toHaveBeenCalled()
  })

  test('no stored repository row and no file: defaults', async () => {
    findSettings.mockResolvedValue([])
    readFile.mockResolvedValue(null)
    await applyPrCommentCommand(event('@uselumo configuration'))
    const body = replyBody()
    expect(body).toContain("No `.lumo.yaml` on `main` at `bbbbbbb` — Lumo's")
    expect(row(body, 'reviews.auto_review.enabled')).toBe(
      '| `reviews.auto_review.enabled` | on | default |'
    )
  })

  test('an invalid file is reported as not applied, with its problems', async () => {
    readFile.mockResolvedValue('reviews:\n  path_filters: 3\n')
    await applyPrCommentCommand(event('@uselumo configuration'))
    const body = replyBody()
    expect(body).toContain('is invalid, so it is **not applied**')
    expect(body).toMatch(/- `line 2, reviews\.path_filters: /)
    expect(row(body, 'reviews.path_filters')).toBe(
      '| `reviews.path_filters` | _(none)_ | repository settings |'
    )
  })
})

describe('prConfigurationService.forPullRequest', () => {
  test("the PR's base unreadable: falls back to the default branch", async () => {
    fetchPrBase.mockRejectedValue(
      Object.assign(new Error('nope'), { status: 404 })
    )
    fetchDefaultBranchHead.mockResolvedValue({ branch: 'trunk', sha: BASE_SHA })
    const view = await prConfigurationService.forPullRequest({
      workspaceId: 'w1',
      repo: 'acme/app',
      prNumber: 9,
    })
    expect(view.repo?.ref).toBe('trunk')
    expect(view.repo?.fromDefaultBranch).toBe(true)
    // The reply says it is the default branch's config, not the PR base's.
    expect(buildConfigurationReply(view)).toContain(
      "couldn't read this PR's base branch, so this is the repository's **default branch** config"
    )
    expect(view.repo?.config.reviewDrafts).toEqual({
      key: 'reviews.auto_review.drafts',
      value: true,
      source: 'file',
    })
  })

  test('a settings read failure at the PR base propagates, not mislabelled as a fallback', async () => {
    findSettings.mockRejectedValue(new Error('db down'))
    await expect(
      prConfigurationService.forPullRequest({
        workspaceId: 'w1',
        repo: 'acme/app',
        prNumber: 9,
      })
    ).rejects.toThrow('db down')
    expect(fetchDefaultBranchHead).not.toHaveBeenCalled()
  })

  test('GitHub unreachable: the repository part is null and the reply says so', async () => {
    fetchPrBase.mockRejectedValue(new Error('down'))
    fetchDefaultBranchHead.mockRejectedValue(new Error('down'))
    const view = await prConfigurationService.forPullRequest({
      workspaceId: 'w1',
      repo: 'acme/app',
      prNumber: 9,
    })
    expect(view.repo).toBeNull()
    const body = buildConfigurationReply(view)
    expect(body).toContain(
      "couldn't read this repository's review configuration"
    )
    // The workspace part is still there.
    expect(body).toContain('| `huntEnabled` | off | workspace setting |')
  })
})

describe('buildConfigurationReply (pure, generic)', () => {
  const view = (
    over: Partial<PrConfigurationView> = {}
  ): PrConfigurationView => ({
    repo: {
      config: {
        a: { key: 'reviews.a', value: true, source: 'file' },
      },
      file: { status: 'loaded', sha: null, problems: [], unknownKeys: [] },
      ref: null,
    },
    switches: { securityScanEnabled: true },
    switchDefaults: { securityScanEnabled: true },
    layers: { scan: true },
    ...over,
  })

  test('keys and sources it was never told about appear without code changes', () => {
    const body = buildConfigurationReply(
      view({
        repo: {
          config: {
            futureKey: {
              key: 'reviews.tools.future',
              value: 7,
              source: 'file',
            },
            otherKey: {
              key: 'reviews.other',
              value: 'x',
              source: 'organization',
            },
          },
          file: {
            status: 'loaded',
            sha: null,
            problems: [],
            unknownKeys: ['zzz'],
          },
          ref: null,
        },
        switches: { securityNewSwitch: 'strict', plainColumn: false },
        switchDefaults: { securityNewSwitch: 'lenient' },
        layers: { newLayer: false },
      })
    )
    expect(body).toContain('| `reviews.tools.future` | `7` | `.lumo.yaml` |')
    expect(body).toContain('| `reviews.other` | `x` | `organization` |')
    expect(body).toContain('| `newSwitch` | `strict` | workspace setting |')
    expect(body).toContain('| `plainColumn` | off | workspace setting |')
    expect(body).toContain('new layer: off')
    expect(body).toContain('Unknown keys (ignored): `zzz`')
  })

  test('repository-authored values are inert: no backticks, pipes or line breaks escape the cell', () => {
    expect(formatConfigValue('a`b|c\nd')).toBe("`a'b\\|c d`")
    expect(formatConfigValue(null)).toBe('_(none)_')
    expect(formatConfigValue([])).toBe('_(none)_')
    expect(formatConfigValue('x'.repeat(200))).toMatch(/^`x{80}…`$/)
    const many = Array.from(
      { length: CONFIG_REPLY_MAX_ITEMS + 3 },
      (_, i) => `u${i}`
    )
    expect(formatConfigValue(many)).toMatch(/\+3 more$/)
  })
})
