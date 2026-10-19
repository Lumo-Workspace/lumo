/**
 * @jest-environment node
 *
 * LUM-1129 — `@<app> review | full review | pause | resume | resolve` in a
 * PR conversation comment. Service level: GitHub clients, the token mint and
 * the repositories are mocked; the parser, the policy gate and the LUM-1127
 * thread resolve run for real.
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
jest.mock('@/lib/integrations/github/review-threads', () => ({
  reviewThreadClient: {
    listReviewThreads: jest.fn().mockResolvedValue([]),
    resolveThread: jest.fn().mockResolvedValue(undefined),
    unresolveThread: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/pr-review-control.service', () => ({
  prReviewControlService: { act: jest.fn() },
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findLatestByPullRequestIds: jest.fn().mockResolvedValue([]),
    updateDisposition: jest.fn(),
  },
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
    // LUM-1142: author approval (default on).
    findAllowAuthorApproval: jest.fn().mockResolvedValue(true),
  },
}))
jest.mock('@/ee/security/repositories/pr-finding-thread.repository', () => ({
  prFindingThreadRepository: {
    findByPullRequest: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(undefined),
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
  ackMarker,
  buildHelpReply,
  buildResolveReply,
  THREAD_TOKEN_REFUSED,
  type PrCommentEvent,
} from '@/ee/security/services/pr-command.service'
import {
  parsePrCommand,
  prCommandHandle,
} from '@/ee/security/services/pr-command-parse'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { checkRepositoryWriteAccess } from '@/lib/integrations/github/collaborator-access'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { reviewThreadClient } from '@/lib/integrations/github/review-threads'
import { prReviewControlService } from '@/ee/security/services/pr-review-control.service'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { prFindingThreadRepository } from '@/ee/security/repositories/pr-finding-thread.repository'
import { isBlockingFinding } from '@/ee/security/services/pr-security-scan-gate'
import { REPO_TOKEN_PERMISSIONS } from '@/lib/integrations/github/token-permissions'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'

const act = prReviewControlService.act as jest.Mock
const access = checkRepositoryWriteAccess as jest.Mock
const reply = prCommentClient.createIssueComment as jest.Mock
const listSince = prCommentClient.listIssueCommentsSince as jest.Mock
const resolveThread = reviewThreadClient.resolveThread as jest.Mock
const listThreads = reviewThreadClient.listReviewThreads as jest.Mock
const findRows = prFindingThreadRepository.findByPullRequest as jest.Mock
const updateRow = prFindingThreadRepository.update as jest.Mock
const latest = prSecurityScanRepository.findLatestByPullRequestIds as jest.Mock
const allowAuthor =
  securityColumnsRepository.findAllowAuthorApproval as jest.Mock

const OLD_SLUG = process.env.GITHUB_APP_SLUG

function event(
  body: string,
  over: Partial<PrCommentEvent> & {
    user?: { login?: string; type?: string } | null
  } = {}
): PrCommentEvent {
  const { user, ...rest } = over
  return {
    workspaceId: 'w1',
    pullRequestId: 'pr1',
    repo: 'acme/app',
    prNumber: 9,
    action: 'created',
    comment: {
      id: 555,
      body,
      createdAt: '2026-10-14T08:00:00Z',
      user: user === undefined ? { login: 'alice', type: 'User' } : user,
    },
    prAuthorLogin: 'bob',
    ...rest,
  }
}

function replyBody(): string {
  return (reply.mock.calls[0]![0] as { body: string }).body
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.GITHUB_APP_SLUG = 'uselumo'
  ;(getRepoToken as jest.Mock).mockImplementation(
    async (_w: string, _r: string, perms: object) =>
      perms === REPO_TOKEN_PERMISSIONS.collaboratorPermission ? 'meta' : 'write'
  )
  access.mockResolvedValue('write')
  allowAuthor.mockResolvedValue(true)
  act.mockResolvedValue({ queued: true })
  listSince.mockResolvedValue([])
})

afterAll(() => {
  if (OLD_SLUG === undefined) delete process.env.GITHUB_APP_SLUG
  else process.env.GITHUB_APP_SLUG = OLD_SLUG
})

describe('parsePrCommand / prCommandHandle', () => {
  it('derives the handle from GITHUB_APP_SLUG, none without it', () => {
    expect(prCommandHandle()).toBe('@uselumo')
    delete process.env.GITHUB_APP_SLUG
    expect(prCommandHandle()).toBeNull()
  })

  it.each([
    ['@uselumo review', 'review'],
    ['@uselumo full review', 'full review'],
    ['@USELUMO  Full   Review!', 'full review'],
    ['@uselumo[bot] pause', 'pause'],
    ['@uselumo: resume', 'resume'],
    ['thanks!\n\n@uselumo resolve', 'resolve'],
    ['@uselumo', 'help'],
    ['@uselumo help', 'help'],
  ])('%j → %s', (body, command) => {
    expect(parsePrCommand(body, '@uselumo')?.command).toBe(command)
  })

  it('an unknown word is addressed but unknown', () => {
    expect(parsePrCommand('@uselumo merge', '@uselumo')).toEqual({
      command: null,
      text: 'merge',
    })
  })

  it.each([
    'thanks @uselumo review',
    '> @uselumo review',
    '```\n@uselumo review\n```',
    '@uselumofan review',
    'LGTM',
  ])('%j is not a command', body => {
    expect(parsePrCommand(body, '@uselumo')).toBeNull()
  })
})

describe('each command maps to the right service call', () => {
  it.each([
    ['@uselumo review', 'incremental'],
    ['@uselumo full review', 'full'],
    ['@uselumo pause', 'pause'],
    ['@uselumo resume', 'resume'],
  ])('%s → prReviewControlService.act(…, %s)', async (body, action) => {
    if (action === 'resume')
      act.mockResolvedValue({
        paused: false,
        rounds: 0,
        limit: 5,
        unit: 'commits',
      })
    await expect(applyPrCommentCommand(event(body))).resolves.toBe('done')
    expect(act).toHaveBeenCalledWith('w1', 9, 'acme/app', action)
    expect(reply).toHaveBeenCalledTimes(1)
    expect(reply.mock.calls[0]![0]).toMatchObject({
      repo: { owner: 'acme', name: 'app' },
      prNumber: 9,
      token: 'write',
    })
    expect(replyBody()).toContain(ackMarker(555, 'w1'))
    if (action === 'resume')
      expect(replyBody()).toContain(
        'every push is reviewed again; they pause again after 5 reviewed commits'
      )
  })

  it('LUM-1137: resume on a workspace that never pauses says so', async () => {
    act.mockResolvedValue({
      paused: false,
      rounds: 0,
      limit: 0,
      unit: 'commits',
    })
    await applyPrCommentCommand(event('@uselumo resume'))
    expect(replyBody()).toContain('automatic reviews never pause')
  })

  it('checks write access with the metadata-only token', async () => {
    await applyPrCommentCommand(event('@uselumo pause'))
    expect(access).toHaveBeenCalledWith('meta', 'acme/app', 'alice')
  })

  it('a refusal from the control service (PR closed) is replied, not thrown', async () => {
    act.mockRejectedValue(
      Object.assign(new Error('PR must be open'), { status: 409 })
    )
    await expect(applyPrCommentCommand(event('@uselumo review'))).resolves.toBe(
      'failed'
    )
    expect(replyBody()).toContain('PR must be open')
  })
})

describe('no-ops', () => {
  it.each(['no_write', 'unknown'])(
    'a commenter without write access (%s) is ignored silently',
    async a => {
      access.mockResolvedValue(a)
      await expect(
        applyPrCommentCommand(event('@uselumo full review'))
      ).resolves.toBe('unauthorized')
      expect(act).not.toHaveBeenCalled()
      expect(reply).not.toHaveBeenCalled()
    }
  )

  it.each([
    { login: 'uselumo[bot]', type: 'Bot' },
    { login: 'renovate[bot]', type: 'Bot' },
    { login: 'ci[bot]', type: 'User' },
    null,
  ])('a bot author (%j) is ignored', async user => {
    await expect(
      applyPrCommentCommand(event('@uselumo review', { user }))
    ).resolves.toBe('ignored_bot')
    expect(access).not.toHaveBeenCalled()
    expect(act).not.toHaveBeenCalled()
  })

  it.each(['edited', 'deleted'])('an %s comment never acts', async action => {
    await expect(
      applyPrCommentCommand(event('@uselumo review', { action }))
    ).resolves.toBe('ignored_action')
    expect(getRepoToken).not.toHaveBeenCalled()
    expect(act).not.toHaveBeenCalled()
  })

  it('an ordinary comment costs no GitHub call', async () => {
    await expect(applyPrCommentCommand(event('LGTM'))).resolves.toBe(
      'not_a_command'
    )
    expect(getRepoToken).not.toHaveBeenCalled()
  })

  it('no configured slug turns commands off', async () => {
    delete process.env.GITHUB_APP_SLUG
    await expect(applyPrCommentCommand(event('@uselumo review'))).resolves.toBe(
      'disabled'
    )
  })

  it('a redelivery Lumo already answered is not run again', async () => {
    listSince.mockResolvedValue([
      {
        id: 900,
        body: `👀 …\n\n${ackMarker(555, 'w1')}`,
        user: { login: 'uselumo[bot]', type: 'Bot' },
      },
    ])
    await expect(applyPrCommentCommand(event('@uselumo review'))).resolves.toBe(
      'duplicate'
    )
    expect(act).not.toHaveBeenCalled()
    expect(reply).not.toHaveBeenCalled()
  })

  it("a human quoting the marker does not count as Lumo's answer", async () => {
    listSince.mockResolvedValue([
      {
        id: 901,
        body: ackMarker(555, 'w1'),
        user: { login: 'mallory', type: 'User' },
      },
    ])
    await expect(applyPrCommentCommand(event('@uselumo review'))).resolves.toBe(
      'done'
    )
  })

  it('the ack marker is per comment and per workspace', () => {
    expect(ackMarker(1, 'w1')).not.toBe(ackMarker(2, 'w1'))
    expect(ackMarker(1, 'w1')).not.toBe(ackMarker(1, 'w2'))
    expect(ackMarker(1, 'w1')).not.toContain('w1')
  })
})

describe('help', () => {
  it('an unknown @uselumo command gets the help reply', async () => {
    await expect(applyPrCommentCommand(event('@uselumo merge'))).resolves.toBe(
      'help'
    )
    expect(act).not.toHaveBeenCalled()
    expect(replyBody()).toContain("doesn't know `merge`")
    expect(replyBody()).toContain('`@uselumo full review`')
  })

  it('the help text lists every command with the configured handle', () => {
    const text = buildHelpReply('@uselumo', null)
    for (const c of ['review', 'full review', 'pause', 'resume', 'resolve'])
      expect(text).toContain(`\`@uselumo ${c}\``)
  })
})

describe('resolve', () => {
  const COMMENT_IDS: Record<string, number> = {
    fpBlock: 101,
    fpLow: 102,
    fpDone: 103,
  }
  const row = (fingerprint: string, state = 'OPEN') => ({
    id: `row-${fingerprint}`,
    pullRequestId: 'pr1',
    fingerprint,
    commentId: String(COMMENT_IDS[fingerprint]),
    threadNodeId: `T-${fingerprint}`,
    state,
    ruleId: 'r',
    provenance: 'DETERMINISTIC',
    kind: 'SECRET',
    filePath: 'a.ts',
    resolvedByLogin: null,
    addressedInSha: null,
  })
  const blockingFinding = {
    fingerprint: 'fpBlock',
    provenance: 'DETERMINISTIC',
    severity: 'HIGH',
    disposition: null,
    persisting: false,
  }

  beforeEach(() => {
    listThreads.mockResolvedValue([])
    findRows.mockResolvedValue([
      row('fpBlock'),
      row('fpLow'),
      row('fpDone', 'ADDRESSED'),
    ])
    latest.mockResolvedValue([
      {
        id: 's1',
        findings: [
          blockingFinding,
          {
            fingerprint: 'fpLow',
            provenance: 'LLM_JUDGE',
            severity: 'MEDIUM',
            disposition: null,
            persisting: false,
          },
        ],
      },
    ])
  })

  it('resolves the open non-blocking threads as the asker; the blocking one stays open and blocking', async () => {
    await expect(
      applyPrCommentCommand(event('@uselumo resolve'))
    ).resolves.toBe('done')
    expect(resolveThread).toHaveBeenCalledTimes(1)
    expect(resolveThread).toHaveBeenCalledWith({
      threadId: 'T-fpLow',
      token: 'write',
    })
    expect(updateRow).toHaveBeenCalledTimes(1)
    expect(updateRow).toHaveBeenCalledWith(
      'row-fpLow',
      expect.objectContaining({
        state: 'RESOLVED_BY_USER',
        resolvedByLogin: 'alice',
      })
    )
    // No disposition is written: the blocking finding still blocks DONE.
    expect(prSecurityScanRepository.updateDisposition).not.toHaveBeenCalled()
    expect(isBlockingFinding(blockingFinding as never)).toBe(true)
    expect(replyBody()).toContain('Resolved 1 Lumo review thread.')
    expect(replyBody()).toContain('Left 1 thread open')
    expect(replyBody()).toContain('lumo finding disposition')
  })

  // LUM-1127 prod regression: resolveReviewThread is refused to a
  // `pull_requests: write`-only token — the command must mint with
  // `contents: write` too.
  it('regression: resolves with a token minted with contents: write', async () => {
    ;(getRepoToken as jest.Mock).mockImplementation(
      async (_w: string, _r: string, perms: object) =>
        perms === REPO_TOKEN_PERMISSIONS.collaboratorPermission
          ? 'meta'
          : JSON.stringify(perms)
    )
    await applyPrCommentCommand(event('@uselumo resolve'))
    expect(resolveThread).toHaveBeenCalledTimes(1)
    expect(JSON.parse(resolveThread.mock.calls[0][0].token)).toEqual({
      pull_requests: 'write',
      contents: 'write',
    })
  })

  it('a refused thread-token mint replies with the missing permission instead of going silent', async () => {
    ;(getRepoToken as jest.Mock).mockImplementation(
      async (_w: string, _r: string, perms: Record<string, string>) => {
        if (perms.contents)
          throw Object.assign(new Error('permissions not granted'), {
            status: 422,
          })
        return perms === REPO_TOKEN_PERMISSIONS.collaboratorPermission
          ? 'meta'
          : 'write'
      }
    )
    await expect(
      applyPrCommentCommand(event('@uselumo resolve'))
    ).resolves.toBe('failed')
    expect(resolveThread).not.toHaveBeenCalled()
    expect(updateRow).not.toHaveBeenCalled()
    expect(replyBody()).toContain(THREAD_TOKEN_REFUSED)
  })

  it('a transient thread-token mint failure asks to retry, not for a permission', async () => {
    ;(getRepoToken as jest.Mock).mockImplementation(
      async (_w: string, _r: string, perms: Record<string, string>) => {
        if (perms.contents) throw new Error('socket hang up')
        return perms === REPO_TOKEN_PERMISSIONS.collaboratorPermission
          ? 'meta'
          : 'write'
      }
    )
    await expect(
      applyPrCommentCommand(event('@uselumo resolve'))
    ).resolves.toBe('failed')
    expect(resolveThread).not.toHaveBeenCalled()
    expect(replyBody()).not.toContain('Contents')
    expect(replyBody()).toContain('try `@uselumo resolve` again later')
  })

  it('an already-resolved thread on GitHub is only recorded', async () => {
    listThreads.mockResolvedValue([
      {
        id: 'T-fpLow',
        isResolved: true,
        isOutdated: false,
        resolvedBy: { login: 'carol', type: 'User' },
        firstCommentId: 102,
      },
    ])
    await applyPrCommentCommand(event('@uselumo resolve'))
    expect(resolveThread).not.toHaveBeenCalled()
    // Credited to whoever resolved it on GitHub, not to the asker.
    expect(updateRow).toHaveBeenCalledWith(
      'row-fpLow',
      expect.objectContaining({
        state: 'RESOLVED_BY_USER',
        resolvedByLogin: 'carol',
      })
    )
  })

  // LUM-1142: author approval — the PR's author may resolve by command
  // unless the workspace turned `allow_author_approval` off.
  it("the PR's author may resolve by default: non-blocking threads resolve, the blocking one stays open", async () => {
    await expect(
      applyPrCommentCommand(
        event('@uselumo resolve', { user: { login: 'Bob', type: 'User' } })
      )
    ).resolves.toBe('done')
    expect(allowAuthor).toHaveBeenCalledWith('w1')
    expect(resolveThread).toHaveBeenCalledTimes(1)
    expect(resolveThread).toHaveBeenCalledWith({
      threadId: 'T-fpLow',
      token: 'write',
    })
    expect(updateRow).toHaveBeenCalledWith(
      'row-fpLow',
      expect.objectContaining({
        state: 'RESOLVED_BY_USER',
        resolvedByLogin: 'Bob',
      })
    )
    expect(prSecurityScanRepository.updateDisposition).not.toHaveBeenCalled()
    expect(replyBody()).toContain('Left 1 thread open')
  })

  it("author approval turned off ⇒ the PR's author is refused, nothing resolved", async () => {
    allowAuthor.mockResolvedValue(false)
    await expect(
      applyPrCommentCommand(
        event('@uselumo resolve', { user: { login: 'Bob', type: 'User' } })
      )
    ).resolves.toBe('refused_author')
    expect(resolveThread).not.toHaveBeenCalled()
    expect(updateRow).not.toHaveBeenCalled()
    expect(replyBody()).toContain("PR's author can't resolve")
  })

  it('a non-author never reads the author setting', async () => {
    allowAuthor.mockResolvedValue(false)
    await expect(
      applyPrCommentCommand(event('@uselumo resolve'))
    ).resolves.toBe('done')
    expect(allowAuthor).not.toHaveBeenCalled()
  })

  it('an author without write access is still ignored silently', async () => {
    access.mockResolvedValue('read')
    await expect(
      applyPrCommentCommand(
        event('@uselumo resolve', { user: { login: 'bob', type: 'User' } })
      )
    ).resolves.toBe('unauthorized')
    expect(resolveThread).not.toHaveBeenCalled()
    expect(reply).not.toHaveBeenCalled()
  })

  it('the PR author may still use the other commands', async () => {
    await expect(
      applyPrCommentCommand(
        event('@uselumo pause', { user: { login: 'bob', type: 'User' } })
      )
    ).resolves.toBe('done')
    expect(act).toHaveBeenCalled()
  })

  it('a thread GitHub refuses is counted, not thrown', async () => {
    resolveThread.mockRejectedValueOnce(new Error('403'))
    await expect(
      applyPrCommentCommand(event('@uselumo resolve'))
    ).resolves.toBe('done')
    expect(replyBody()).toContain('Could not resolve 1 thread')
  })

  it('reply wording for nothing to resolve', () => {
    expect(
      buildResolveReply({ resolved: 0, kept: 0, failed: 0 }, '@uselumo')
    ).toContain('No open Lumo review threads')
  })
})
