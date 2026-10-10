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
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: { scrubCodeForWorkspace: jest.fn() },
}))

import { getPluginRegistry } from '@/lib/plugins/registry'
import { INSTALLED_SERVER_PLUGINS } from '@/lib/plugins/installed'
import { securityPlugin } from '@/ee/security/server'
import { collectDoneGateBlockers } from '@/lib/plugins/done-gate'
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
  expect(registry.retention.map(r => r.key)).toEqual(['scanEvidence'])
  expect(registry.handlersFor('github.pullRequest')).toHaveLength(1)
  expect(registry.handlersFor('github.push')).toHaveLength(1)
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
    expect(mockWaitUntil).not.toHaveBeenCalled()
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
      workspaceId: 'w-1',
      repo: 'o/r',
      sha: 'abc',
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
