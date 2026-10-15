/**
 * @jest-environment node
 *
 * LUM-1151 — the description sync service (read-modify-write with the
 * latest body, nothing written when unchanged) and `@<app> summary`, which
 * regenerates the summary in the PR description from the latest review.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/lib/integrations/github/collaborator-access', () => ({
  checkRepositoryWriteAccess: jest.fn(),
}))
jest.mock('@/lib/integrations/github/pr-comment-client', () => {
  const actual = jest.requireActual(
    '@/lib/integrations/github/pr-comment-client'
  )
  return {
    GithubApiError: actual.GithubApiError,
    prCommentClient: {
      createIssueComment: jest.fn().mockResolvedValue({ id: 900 }),
      listIssueCommentsSince: jest.fn().mockResolvedValue([]),
      getPullRequestBody: jest.fn(),
      updatePullRequestBody: jest.fn(),
    },
  }
})
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findLatestSummaryByPullRequest: jest.fn(),
    findLatestByPullRequestIds: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/ee/security/services/pr-review-control.service', () => ({
  prReviewControlService: { act: jest.fn() },
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
    findAllowAuthorApproval: jest.fn().mockResolvedValue(true),
  },
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
import {
  buildSummaryCommandReply,
  prDescriptionSummaryService,
} from '@/ee/security/services/pr-description-summary.service'
import { commandsBlock } from '@/ee/security/services/security-pr-review.service'
import {
  DESCRIPTION_SUMMARY_END,
  DESCRIPTION_SUMMARY_START,
} from '@/ee/security/security-scan/pr-description-summary'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { checkRepositoryWriteAccess } from '@/lib/integrations/github/collaborator-access'
import {
  GithubApiError,
  prCommentClient,
} from '@/lib/integrations/github/pr-comment-client'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'

const getBody = prCommentClient.getPullRequestBody as jest.Mock
const updateBody = prCommentClient.updatePullRequestBody as jest.Mock
const reply = prCommentClient.createIssueComment as jest.Mock
const latest =
  prSecurityScanRepository.findLatestSummaryByPullRequest as jest.Mock

const SHA = 'abcdef1234567890abcdef1234567890abcdef12'
const SUMMARY = { intent: 'Adds a retry to the webhook sender.', changes: [] }
const REPO = { owner: 'acme', name: 'app' }
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

function written(): string {
  return (updateBody.mock.calls[0]![0] as { body: string }).body
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.GITHUB_APP_SLUG = 'uselumo'
  ;(getRepoToken as jest.Mock).mockResolvedValue('token')
  ;(checkRepositoryWriteAccess as jest.Mock).mockResolvedValue('write')
  getBody.mockResolvedValue({ body: 'Author text.', state: 'open' })
  updateBody.mockResolvedValue(undefined)
  latest.mockResolvedValue({
    id: 's1',
    headSha: SHA,
    prSummary: SUMMARY,
    highLevelSummary: null,
  })
})

afterAll(() => {
  if (OLD_SLUG === undefined) delete process.env.GITHUB_APP_SLUG
  else process.env.GITHUB_APP_SLUG = OLD_SLUG
})

describe('prDescriptionSummaryService.sync', () => {
  const input = {
    repo: REPO,
    prNumber: 9,
    token: 't',
    prSummary: SUMMARY,
    headSha: SHA,
  }

  it('reads the latest description and writes the block into it', async () => {
    await expect(prDescriptionSummaryService.sync(input)).resolves.toBe(
      'written'
    )
    expect(getBody).toHaveBeenCalledTimes(1)
    expect(written().startsWith('Author text.\n\n')).toBe(true)
    expect(written()).toContain(DESCRIPTION_SUMMARY_START)
    expect(written()).toContain(SUMMARY.intent)
  })

  it('keeps an author edit made after the previous review (read-modify-write)', async () => {
    getBody.mockResolvedValueOnce({ body: 'v1', state: 'open' })
    await prDescriptionSummaryService.sync(input)
    const afterFirst = written()
    // The author edits outside Lumo's block before the next review.
    getBody.mockResolvedValueOnce({
      body: `Edited by author\n\n${afterFirst}`,
      state: 'open',
    })
    await prDescriptionSummaryService.sync({
      ...input,
      prSummary: { intent: 'Now also logs retries.', changes: [] },
    })
    const second = (updateBody.mock.calls[1]![0] as { body: string }).body
    expect(second.startsWith('Edited by author\n\nv1\n\n')).toBe(true)
    expect(second).toContain('Now also logs retries.')
    expect(second).not.toContain(SUMMARY.intent)
  })

  it('writes nothing when the description already says it', async () => {
    await prDescriptionSummaryService.sync(input)
    getBody.mockResolvedValueOnce({ body: written(), state: 'open' })
    updateBody.mockClear()
    await expect(prDescriptionSummaryService.sync(input)).resolves.toBe(
      'unchanged'
    )
    expect(updateBody).not.toHaveBeenCalled()
  })

  it('makes no GitHub call when the review has no summary', async () => {
    await expect(
      prDescriptionSummaryService.sync({ ...input, prSummary: null })
    ).resolves.toBe('no_summary')
    expect(getBody).not.toHaveBeenCalled()
  })

  it('leaves a closed PR alone and never throws', async () => {
    getBody.mockResolvedValueOnce({ body: 'x', state: 'closed' })
    await expect(prDescriptionSummaryService.sync(input)).resolves.toBe(
      'not_open'
    )
    getBody.mockRejectedValueOnce(new GithubApiError(403, { message: 'no' }))
    await expect(prDescriptionSummaryService.sync(input)).resolves.toBe(
      'failed'
    )
    expect(updateBody).not.toHaveBeenCalled()
  })
})

describe('@uselumo summary', () => {
  it('parses as a command and is listed in the help and the summary', () => {
    expect(parsePrCommand('@uselumo summary', '@uselumo')).toEqual({
      command: 'summary',
      text: 'summary',
    })
    expect(buildHelpReply('@uselumo', null)).toContain('`@uselumo summary`')
    expect(commandsBlock('@uselumo')).toContain('`@uselumo summary`')
  })

  it('regenerates the summary in the description and says so', async () => {
    getBody.mockResolvedValue({
      body: 'Intro\n\n@uselumo summary\n\nOutro',
      state: 'open',
    })
    await expect(
      applyPrCommentCommand(event('@uselumo summary'))
    ).resolves.toBe('done')
    expect(written()).toMatch(
      /^Intro\n\n<!-- lumo:summary:start -->[\s\S]*<!-- lumo:summary:end -->\n\nOutro$/
    )
    expect(replyBody()).toContain('Updated the summary in the PR description')
    expect(replyBody()).toContain('abcdef1')
  })

  it('rewrites a block the author changed', async () => {
    getBody.mockResolvedValue({
      body: `Intro\n\n${DESCRIPTION_SUMMARY_START}\nmangled\n${DESCRIPTION_SUMMARY_END}`,
      state: 'open',
    })
    await applyPrCommentCommand(event('@uselumo summary'))
    expect(written()).not.toContain('mangled')
    expect(written()).toContain(SUMMARY.intent)
  })

  it('does not touch the description when the setting is off or comment', async () => {
    latest.mockResolvedValueOnce({
      id: 's1',
      headSha: SHA,
      prSummary: SUMMARY,
      highLevelSummary: 'off',
    })
    await expect(
      applyPrCommentCommand(event('@uselumo summary'))
    ).resolves.toBe('refused_mode_off')
    expect(replyBody()).toContain('turned off for this repository')
    latest.mockResolvedValueOnce({
      id: 's1',
      headSha: SHA,
      prSummary: SUMMARY,
      highLevelSummary: 'comment',
    })
    await applyPrCommentCommand({
      ...event('@uselumo summary'),
      comment: { ...event('').comment, id: 556, body: '@uselumo summary' },
    })
    expect(getBody).not.toHaveBeenCalled()
    expect(updateBody).not.toHaveBeenCalled()
  })

  it('answers when there is no review or no summary yet', async () => {
    latest.mockResolvedValueOnce(null)
    await expect(
      applyPrCommentCommand(event('@uselumo summary'))
    ).resolves.toBe('refused_unreviewed')
    expect(replyBody()).toContain('has not reviewed this PR yet')
    expect(updateBody).not.toHaveBeenCalled()
  })

  it('a commenter without write access gets nothing', async () => {
    ;(checkRepositoryWriteAccess as jest.Mock).mockResolvedValue('read')
    await expect(
      applyPrCommentCommand(event('@uselumo summary'))
    ).resolves.toBe('unauthorized')
    expect(updateBody).not.toHaveBeenCalled()
    expect(reply).not.toHaveBeenCalled()
  })
})

describe('buildSummaryCommandReply', () => {
  it('words every outcome', () => {
    const h = '@uselumo'
    expect(buildSummaryCommandReply({ kind: 'comment' }, h)).toContain(
      'summary comment'
    )
    expect(
      buildSummaryCommandReply({ kind: 'no_summary', sha: SHA }, h)
    ).toContain('`@uselumo review`')
    expect(buildSummaryCommandReply({ kind: 'failed' }, h)).toContain(
      '`@uselumo summary`'
    )
    expect(buildSummaryCommandReply({ kind: 'not_open' }, h)).toContain(
      'not open'
    )
    expect(
      buildSummaryCommandReply({ kind: 'written', sha: SHA, changed: false }, h)
    ).toContain('already up to date')
  })
})
