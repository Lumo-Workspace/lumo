/**
 * @jest-environment node
 *
 * LUM-1061 — the security plugin (ee/security/server.ts) is what the private
 * deployment installs, and it registers the pre-PR2 implementations
 * unchanged: the same functions are called with the same arguments as when
 * the core imported them directly. (Behaviour of the surfaces end-to-end
 * stays covered by the existing route / service tests, which run through the
 * registry now.)
 */
const mockWaitUntil = jest.fn((p: Promise<unknown>) => p)
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => mockWaitUntil(p),
}))
jest.mock('@/ee/security/services/pr-security-scan-gate', () => ({
  listOpenBlockingFindings: jest.fn(),
}))
jest.mock('@/ee/security/services/pr-security-reminder.service', () => ({
  prSecurityReminderService: {
    buildSessionStartSection: jest.fn(),
    loadOpenFindingsForTask: jest.fn(),
    buildAgentReminder: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/pr-security-scan-dispatch', () => ({
  dispatchPrSecurityScan: jest.fn().mockResolvedValue('dispatched'),
  shouldScanOnPrEvent: jest.requireActual(
    '@/ee/security/services/pr-security-scan-dispatch'
  ).shouldScanOnPrEvent,
}))
jest.mock('@/ee/security/services/security-baseline.service', () => ({
  securityBaselineService: { requestFromPush: jest.fn() },
}))
jest.mock('@/ee/security/services/pr-finding-thread.service', () => ({
  applyReviewThreadEvent: jest.fn().mockResolvedValue('recorded'),
}))
jest.mock('@/ee/security/services/review-learnings.service', () => ({
  promoteLearningsOnMerge: jest.fn().mockResolvedValue(1),
}))
jest.mock('@/ee/security/services/pr-thread-reply.service', () => ({
  applyThreadReply: jest.fn().mockResolvedValue('acknowledged'),
}))
jest.mock('@/ee/security/services/pr-command.service', () => ({
  applyPrCommentCommand: jest.fn().mockResolvedValue('done'),
}))
jest.mock('@/ee/security/services/pr-chat.service', () => ({
  applyLineMention: jest.fn().mockResolvedValue('answered'),
  applyConversationQuestion: jest.fn().mockResolvedValue('answered'),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    scrubCodeForWorkspace: jest.fn(),
    anyScanForTask: jest.fn(),
  },
}))

import { getPluginRegistry } from '@/lib/plugins/registry'
import { INSTALLED_SERVER_PLUGINS } from '@/lib/plugins/installed'
import { securityPlugin } from '@/ee/security/server'
import {
  collectDoneGateBlockers,
  readDoneGatePluginRow,
} from '@/lib/plugins/done-gate'
import {
  collectPreToolUseReminders,
  collectSessionStartSections,
  collectTaskStatusSections,
} from '@/lib/plugins/agent-context'
import { emitCoreEvent } from '@/lib/plugins/events'
import { scrubPluginRepositoryCode } from '@/lib/plugins/retention'
import { retentionStockCategories } from '@/lib/services/retention-stock.service'
import { listOpenBlockingFindings } from '@/ee/security/services/pr-security-scan-gate'
import { prSecurityReminderService } from '@/ee/security/services/pr-security-reminder.service'
import { dispatchPrSecurityScan } from '@/ee/security/services/pr-security-scan-dispatch'
import { securityBaselineService } from '@/ee/security/services/security-baseline.service'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { logger } from '@/lib/logger'
import { applyReviewThreadEvent } from '@/ee/security/services/pr-finding-thread.service'
import { applyThreadReply } from '@/ee/security/services/pr-thread-reply.service'
import { promoteLearningsOnMerge } from '@/ee/security/services/review-learnings.service'
import { applyPrCommentCommand } from '@/ee/security/services/pr-command.service'
import {
  applyConversationQuestion,
  applyLineMention,
} from '@/ee/security/services/pr-chat.service'

const reminder = prSecurityReminderService as unknown as Record<
  string,
  jest.Mock
>
const dispatch = dispatchPrSecurityScan as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

it('is the one installed plugin and registers every server extension point', () => {
  expect(INSTALLED_SERVER_PLUGINS).toEqual([securityPlugin])
  const registry = getPluginRegistry()
  expect(registry.plugins).toEqual(['security'])
  expect(registry.doneGates.map(g => g.id)).toEqual(['security'])
  expect(registry.agentContexts.map(c => c.id)).toEqual(['security'])
  // LUM-1259: the local scan log's daily sweep.
  expect(registry.retention.map(r => r.key)).toEqual([
    'localScanLog',
    'scanEvidence',
  ])
  // LUM-1318: the plugin listens on the provider-neutral event.
  expect(registry.handlersFor('git.pullRequest')).toHaveLength(1)
  expect(registry.handlersFor('github.pullRequest')).toHaveLength(0)
  // LUM-1318: the plugin listens on the provider-neutral event.
  expect(registry.handlersFor('git.push')).toHaveLength(1)
  expect(registry.handlersFor('github.push')).toHaveLength(0)
  // LUM-1318: the plugin listens on the provider-neutral event.
  expect(registry.handlersFor('git.reviewThread')).toHaveLength(1)
  expect(registry.handlersFor('github.reviewThread')).toHaveLength(0)
  // LUM-1318: the plugin listens on the provider-neutral event.
  expect(registry.handlersFor('git.reviewComment')).toHaveLength(1)
  expect(registry.handlersFor('github.reviewComment')).toHaveLength(0)
  // LUM-1318: the plugin listens on the provider-neutral event.
  expect(registry.handlersFor('git.issueComment')).toHaveLength(1)
  expect(registry.handlersFor('github.issueComment')).toHaveLength(0)
  expect(registry.handlersFor('task.prLinked')).toHaveLength(1)
})

it('keeps the retention-stock categories and their order', () => {
  expect(retentionStockCategories()).toEqual([
    'scan-evidence',
    'crossing-raw',
    'dead-letter',
  ])
})

describe('DONE gate', () => {
  it('blocks on the undispositioned blocking findings', async () => {
    ;(listOpenBlockingFindings as jest.Mock).mockResolvedValue([
      { ruleId: 'secret:aws', filePath: 'a.ts' },
    ])
    await expect(collectDoneGateBlockers('t-1')).resolves.toEqual([
      { ruleId: 'secret:aws', filePath: 'a.ts' },
    ])
    expect(listOpenBlockingFindings).toHaveBeenCalledWith('t-1')
  })

  it('LUM-1186: reports whether the task has a scan (not scanned vs clear)', async () => {
    ;(listOpenBlockingFindings as jest.Mock).mockResolvedValue([])
    const anyScan = prSecurityScanRepository.anyScanForTask as jest.Mock
    anyScan.mockResolvedValue(true)
    await expect(readDoneGatePluginRow('t-1')).resolves.toEqual({
      present: true,
      blocking: 0,
      checked: true,
    })
    expect(anyScan).toHaveBeenCalledWith('t-1')
    anyScan.mockResolvedValue(false)
    await expect(readDoneGatePluginRow('t-1')).resolves.toMatchObject({
      checked: false,
    })
  })

  it('stays fail-closed: a read failure refuses to answer', async () => {
    ;(listOpenBlockingFindings as jest.Mock).mockRejectedValue(
      new Error('db down')
    )
    await expect(collectDoneGateBlockers('t-1')).rejects.toThrow('db down')
  })
})

describe('agent context', () => {
  it('session-start section is the reminder service section', async () => {
    reminder.buildSessionStartSection!.mockResolvedValue('## Security')
    await expect(
      collectSessionStartSections({ taskId: 't-1', taskIdentifier: 'LUM-1' })
    ).resolves.toBe('## Security')
    expect(reminder.buildSessionStartSection).toHaveBeenCalledWith(
      't-1',
      'LUM-1'
    )
  })

  it('PreToolUse serves the reminder as securityReminder', async () => {
    reminder.buildAgentReminder!.mockResolvedValue('SECURITY')
    await expect(
      collectPreToolUseReminders({ sessionId: 's-1', taskId: 't-1' })
    ).resolves.toEqual({ securityReminder: 'SECURITY' })
    expect(reminder.buildAgentReminder).toHaveBeenCalledWith('t-1')
  })

  it('task status: a failed read is securityFindings:null, never an absent field', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {})
    reminder.loadOpenFindingsForTask!.mockRejectedValue(new Error('db down'))
    await expect(collectTaskStatusSections('t-1')).resolves.toEqual({
      nextActions: [],
      fields: { securityFindings: null },
    })
    expect(warn).toHaveBeenCalledWith('taskStatus.securityRead.failed', {
      taskId: 't-1',
      error: 'db down',
    })
    warn.mockRestore()
  })
})

describe('events', () => {
  const pr = {
    workspaceId: 'w-1',
    taskId: 't-1',
    pullRequestId: 'pr-1',
    state: 'open',
    repo: 'acme/app',
    prNumber: 1,
    isDraft: false,
  }

  it('scans an open PR on opened / synchronize / reopened, with waitUntil', () => {
    for (const action of ['opened', 'synchronize', 'reopened']) {
      emitCoreEvent('github.pullRequest', { ...pr, action })
    }
    expect(dispatch.mock.calls).toEqual([
      ['pr-1', 'PR_EVENT'],
      ['pr-1', 'PR_EVENT'],
      ['pr-1', 'PR_EVENT'],
    ])
    expect(mockWaitUntil).toHaveBeenCalledTimes(3)
    expect(mockWaitUntil).toHaveBeenCalledWith(dispatch.mock.results[0]!.value)
  })

  it('does not scan an edited or closed PR', () => {
    emitCoreEvent('github.pullRequest', { ...pr, action: 'edited' })
    emitCoreEvent('github.pullRequest', {
      ...pr,
      action: 'closed',
      state: 'merged',
    })
    expect(dispatch).not.toHaveBeenCalled()
    // LUM-1131: the merged event's only background work is the learning
    // promotion, not a scan.
    expect(mockWaitUntil).toHaveBeenCalledTimes(1)
  })

  it('scans a manually linked PR once', () => {
    emitCoreEvent('task.prLinked', { taskId: 't-1', pullRequestId: 'pr-2' })
    expect(dispatch.mock.calls).toEqual([['pr-2', 'PR_LINK']])
    expect(mockWaitUntil).toHaveBeenCalledWith(dispatch.mock.results[0]!.value)
  })

  it('refreshes the baseline on a default-branch push only', async () => {
    const push = {
      workspaceId: 'w-1',
      repo: 'o/r',
      branch: 'feature',
      isDefaultBranch: false,
      headSha: 'abc',
    }
    emitCoreEvent('github.push', push)
    expect(mockWaitUntil).not.toHaveBeenCalled()

    emitCoreEvent('github.push', {
      ...push,
      branch: 'main',
      isDefaultBranch: true,
    })
    expect(mockWaitUntil).toHaveBeenCalledTimes(1)
    await mockWaitUntil.mock.results[0]!.value
    expect(securityBaselineService.requestFromPush).toHaveBeenCalledWith({
      provider: 'github',
      workspaceId: 'w-1',
      repo: 'o/r',
      sha: 'abc',
    })
  })

  it('LUM-1127: a review-thread event is applied by the thread service, with waitUntil', async () => {
    const event = {
      workspaceId: 'w-1',
      pullRequestId: 'pr-1',
      action: 'resolved',
      threadNodeId: 'PRRT_1',
      comments: [],
      sender: { login: 'alice', type: 'User' },
    }
    emitCoreEvent('github.reviewThread', event)
    expect(mockWaitUntil).toHaveBeenCalledTimes(1)
    await mockWaitUntil.mock.results[0]!.value
    expect(applyReviewThreadEvent).toHaveBeenCalledWith({
      ...event,
      provider: 'github',
    })
  })

  it('LUM-1131: a merged PR promotes its learnings, with waitUntil; other states do not', async () => {
    emitCoreEvent('github.pullRequest', {
      workspaceId: 'w-1',
      taskId: 't-1',
      pullRequestId: 'pr-1',
      action: 'closed',
      state: 'merged',
      repo: 'acme/app',
      prNumber: 1,
      isDraft: false,
    })
    await Promise.all(mockWaitUntil.mock.results.map(r => r.value))
    expect(promoteLearningsOnMerge).toHaveBeenCalledWith('w-1', 'pr-1')
    ;(promoteLearningsOnMerge as jest.Mock).mockClear()
    emitCoreEvent('github.pullRequest', {
      workspaceId: 'w-1',
      taskId: 't-1',
      pullRequestId: 'pr-1',
      action: 'closed',
      state: 'closed',
      repo: 'acme/app',
      prNumber: 1,
      isDraft: false,
    })
    await Promise.all(mockWaitUntil.mock.results.map(r => r.value))
    expect(promoteLearningsOnMerge).not.toHaveBeenCalled()
  })

  it('LUM-1131: a created reply is handed to the thread-reply service, with waitUntil; anything else is not', async () => {
    const event = {
      workspaceId: 'w-1',
      pullRequestId: 'pr-1',
      taskId: null,
      repo: 'o/r',
      prNumber: 3,
      action: 'created',
      comment: {
        id: 7,
        body: 'This is intentional because …',
        inReplyToId: 5,
        user: { login: 'alice', type: 'User' },
        authorAssociation: 'COLLABORATOR',
      },
    }
    emitCoreEvent('github.reviewComment', event)
    expect(mockWaitUntil).toHaveBeenCalledTimes(1)
    await mockWaitUntil.mock.results[0]!.value
    expect(applyThreadReply).toHaveBeenCalledWith({
      ...event,
      provider: 'github',
    })

    mockWaitUntil.mockClear()
    emitCoreEvent('github.reviewComment', { ...event, action: 'edited' })
    emitCoreEvent('github.reviewComment', {
      ...event,
      comment: { ...event.comment, inReplyToId: null },
    })
    expect(mockWaitUntil).not.toHaveBeenCalled()
  })

  describe('LUM-1154: questions to Lumo', () => {
    const OLD_SLUG = process.env.GITHUB_APP_SLUG
    beforeEach(() => {
      process.env.GITHUB_APP_SLUG = 'uselumo'
    })
    afterEach(() => {
      if (OLD_SLUG === undefined) delete process.env.GITHUB_APP_SLUG
      else process.env.GITHUB_APP_SLUG = OLD_SLUG
    })
    const review = (body: string, inReplyToId: number | null) => ({
      workspaceId: 'w-1',
      pullRequestId: 'pr-1',
      taskId: null,
      repo: 'o/r',
      prNumber: 3,
      action: 'created',
      comment: {
        id: 8,
        body,
        inReplyToId,
        user: { login: 'alice', type: 'User' },
        authorAssociation: 'COLLABORATOR',
        path: 'src/a.ts',
        line: 4,
        diffHunk: null,
      },
    })
    const settle = () =>
      Promise.all(mockWaitUntil.mock.results.map(r => r.value))

    it('a new line comment mentioning the App goes to the chat', async () => {
      const event = review('@uselumo why is this unsafe?', null)
      emitCoreEvent('github.reviewComment', event)
      await settle()
      expect(applyThreadReply).not.toHaveBeenCalled()
      expect(applyLineMention).toHaveBeenCalledWith({
        ...event,
        provider: 'github',
      })
    })

    it('a reply goes to the thread-reply service first; only outside a Lumo thread to the chat', async () => {
      ;(applyThreadReply as jest.Mock).mockResolvedValueOnce('answered')
      emitCoreEvent('github.reviewComment', review('@uselumo why?', 5))
      await settle()
      expect(applyThreadReply).toHaveBeenCalledTimes(1)
      expect(applyLineMention).not.toHaveBeenCalled()

      mockWaitUntil.mockClear()
      ;(applyThreadReply as jest.Mock).mockResolvedValueOnce('not_lumo_thread')
      emitCoreEvent('github.reviewComment', review('@uselumo why?', 5))
      await settle()
      expect(applyLineMention).toHaveBeenCalledTimes(1)

      mockWaitUntil.mockClear()
      ;(applyThreadReply as jest.Mock).mockResolvedValueOnce('not_lumo_thread')
      emitCoreEvent('github.reviewComment', review('no mention here', 5))
      await settle()
      expect(applyLineMention).toHaveBeenCalledTimes(1)
    })

    it('a conversation question goes to the chat; a command still to the command service', async () => {
      const ask = (body: string) => ({
        workspaceId: 'w-1',
        pullRequestId: 'pr-1',
        repo: 'o/r',
        prNumber: 7,
        action: 'created',
        comment: {
          id: 1,
          body,
          createdAt: null,
          user: { login: 'alice', type: 'User' },
        },
        prAuthorLogin: 'bob',
      })
      emitCoreEvent('github.issueComment', ask('@uselumo why is db.ts unsafe?'))
      emitCoreEvent('github.issueComment', ask('@uselumo review'))
      await settle()
      expect(applyConversationQuestion).toHaveBeenCalledTimes(1)
      expect(applyPrCommentCommand).toHaveBeenCalledTimes(1)
      expect(
        (applyPrCommentCommand as jest.Mock).mock.calls[0][0].comment.body
      ).toBe('@uselumo review')
    })
  })

  describe('LUM-1129: PR comment commands', () => {
    const OLD_SLUG = process.env.GITHUB_APP_SLUG
    afterEach(() => {
      if (OLD_SLUG === undefined) delete process.env.GITHUB_APP_SLUG
      else process.env.GITHUB_APP_SLUG = OLD_SLUG
    })
    const comment = (body: string, action = 'created') => ({
      workspaceId: 'w-1',
      pullRequestId: 'pr-1',
      repo: 'o/r',
      prNumber: 7,
      action,
      comment: {
        id: 1,
        body,
        createdAt: null,
        user: { login: 'alice', type: 'User' },
      },
      prAuthorLogin: 'bob',
    })

    it('a command comment is applied by the command service, with waitUntil', async () => {
      process.env.GITHUB_APP_SLUG = 'uselumo'
      const event = comment('@uselumo pause')
      emitCoreEvent('github.issueComment', event)
      expect(mockWaitUntil).toHaveBeenCalledTimes(1)
      await mockWaitUntil.mock.results[0]!.value
      expect(applyPrCommentCommand).toHaveBeenCalledWith({
        ...event,
        provider: 'github',
      })
    })

    it('an ordinary comment, an edit, or no configured slug loads nothing', () => {
      process.env.GITHUB_APP_SLUG = 'uselumo'
      emitCoreEvent('github.issueComment', comment('LGTM, thanks'))
      emitCoreEvent('github.issueComment', comment('@uselumo pause', 'edited'))
      delete process.env.GITHUB_APP_SLUG
      emitCoreEvent('github.issueComment', comment('@uselumo pause'))
      expect(mockWaitUntil).not.toHaveBeenCalled()
      expect(applyPrCommentCommand).not.toHaveBeenCalled()
    })
  })

  it('a failing baseline request is logged, never thrown', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {})
    ;(securityBaselineService.requestFromPush as jest.Mock).mockRejectedValue(
      new Error('octokit')
    )
    emitCoreEvent('github.push', {
      workspaceId: 'w-1',
      repo: 'o/r',
      branch: 'main',
      isDefaultBranch: true,
      headSha: 'abc',
    })
    await expect(mockWaitUntil.mock.results[0]!.value).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(
      '[webhook] security baseline request failed:',
      'octokit'
    )
    warn.mockRestore()
  })
})

describe('retention', () => {
  it('scrubs the scan code of the given repositories and reports the counts', async () => {
    ;(
      prSecurityScanRepository.scrubCodeForWorkspace as jest.Mock
    ).mockResolvedValue({ scans: 2, findings: 5 })
    await expect(
      scrubPluginRepositoryCode({ workspaceId: 'w-1', repos: ['o/r'] })
    ).resolves.toEqual({ scan: 2, finding: 5 })
    expect(prSecurityScanRepository.scrubCodeForWorkspace).toHaveBeenCalledWith(
      'w-1',
      ['o/r']
    )
  })

  it('a scrub that fails throws, so nothing narrows before the code is gone', async () => {
    ;(
      prSecurityScanRepository.scrubCodeForWorkspace as jest.Mock
    ).mockRejectedValue(new Error('db down'))
    await expect(
      scrubPluginRepositoryCode({ workspaceId: 'w-1' })
    ).rejects.toThrow('db down')
  })
})
