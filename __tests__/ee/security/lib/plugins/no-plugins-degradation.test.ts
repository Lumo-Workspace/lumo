/**
 * @jest-environment node
 *
 * LUM-1061 — with no plugin installed (the open-source snapshot replaces
 * lib/plugins/installed.ts with an empty list), every server extension point
 * degrades the way RFC LUM-1058 §3.4 says:
 *   - DONE gate: only crossings and test cases decide; a missing plugin never
 *     blocks DONE.
 *   - agent context: no security section at session-start / attach, no
 *     `securityFindings` field and no SECURITY_FINDING rows in task status,
 *     no `securityReminder` on the PreToolUse hook.
 *   - events: PR / push / link events start nothing.
 *   - retention: the stock script only knows the core categories; losing
 *     GitHub access scrubs no plugin data.
 * The plugin modules are mocked so a stray call into them would show up.
 */
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))

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
  dispatchPrSecurityScan: jest.fn(),
  shouldScanOnPrEvent: jest.fn(() => true),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: { scrubCodeForWorkspace: jest.fn() },
}))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))

// DONE gate: the core planes.
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findUndispositionedByTask: jest.fn(async () => []),
    isGateEnabledForWorkspace: jest.fn(async () => true),
  },
}))
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: {
    listForTask: jest.fn(async () => []),
    runsPerCase: jest.fn(async () => new Map()),
  },
}))

// Task status: the core read model's own reads.
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listForLifecycle: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    create: jest.fn(),
    listByTaskAndType: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findHeaderById: jest.fn(async () => ({
      id: 't-1',
      number: 1061,
      title: 'plugin registry',
      status: 'IN_PROGRESS',
      team: { identifier: 'LUM' },
    })),
    findStatus: jest.fn(),
    loadClaimSnapshot: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: {
    loadActuals: jest.fn(() => Promise.resolve(null)),
    loadPerSessionCost: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    loadLatestRunClaim: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/claim-faithfulness-verdict.repository', () => ({
  claimFaithfulnessVerdictRepository: {
    findByTaskId: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/db/prisma', () => ({
  prisma: { $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({})) },
}))

// PreToolUse hook route.
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/hook-event.service', () => ({
  hookEventService: { recordHookEvent: jest.fn() },
}))
jest.mock('@/lib/services/collision.service', () => ({
  collisionService: { checkFileCollision: jest.fn(async () => null) },
}))
jest.mock('@/lib/services/boundary-crossing.service', () => ({
  boundaryCrossingService: { buildAgentReminder: jest.fn(async () => null) },
}))

import { getPluginRegistry } from '@/lib/plugins/registry'
import { collectDoneGateBlockers } from '@/lib/plugins/done-gate'
import {
  collectPreToolUseReminders,
  collectSessionStartSections,
  collectTaskStatusSections,
} from '@/lib/plugins/agent-context'
import { emitCoreEvent } from '@/lib/plugins/events'
import { scrubPluginRepositoryCode } from '@/lib/plugins/retention'
import { readDoneVerdict } from '@/lib/services/done-verdict.service'
import { taskStatusService } from '@/lib/services/task-status.service'
import {
  isRetentionStockCategory,
  retentionStockCategories,
  retentionStockService,
} from '@/lib/services/retention-stock.service'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { listOpenBlockingFindings } from '@/ee/security/services/pr-security-scan-gate'
import { prSecurityReminderService } from '@/ee/security/services/pr-security-reminder.service'
import { dispatchPrSecurityScan } from '@/ee/security/services/pr-security-scan-dispatch'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { waitUntil } from '@/lib/runtime/wait-until'
import { authService } from '@/lib/services/auth.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import { POST as preToolUse } from '@/app/api/hooks/pre-tool-use/route'

function expectNoPluginCalls() {
  expect(listOpenBlockingFindings).not.toHaveBeenCalled()
  for (const fn of Object.values(prSecurityReminderService))
    expect(fn).not.toHaveBeenCalled()
  expect(dispatchPrSecurityScan).not.toHaveBeenCalled()
  expect(prSecurityScanRepository.scrubCodeForWorkspace).not.toHaveBeenCalled()
  expect(waitUntil).not.toHaveBeenCalled()
}

beforeEach(() => {
  jest.clearAllMocks()
})

afterEach(() => {
  expectNoPluginCalls()
})

it('the registry is empty', () => {
  const registry = getPluginRegistry()
  expect(registry.plugins).toEqual([])
  expect(registry.doneGates).toEqual([])
  expect(registry.agentContexts).toEqual([])
  expect(registry.retention).toEqual([])
})

describe('DONE gate', () => {
  it('contributes no blockers, so a clean task is CLEAR', async () => {
    await expect(collectDoneGateBlockers('t-1')).resolves.toEqual([])
    await expect(readDoneVerdict('t-1', 'w-1')).resolves.toEqual({
      decision: 'CLEAR',
      blockers: [],
      advisories: [],
    })
  })

  it('the core crossing plane still blocks on its own', async () => {
    ;(
      boundaryCrossingRepository.findUndispositionedByTask as jest.Mock
    ).mockResolvedValueOnce([
      { category: 'HARDCODED_SECRET', severity: 'HIGH' },
    ])
    const verdict = await readDoneVerdict('t-1', 'w-1')
    expect(verdict.decision).toBe('BLOCKED')
    expect(verdict.blockers.map(b => b.plane)).toEqual(['BOUNDARY_CROSSING'])
  })
})

describe('agent context', () => {
  it('session-start / attach get no plugin section', async () => {
    await expect(
      collectSessionStartSections({ taskId: 't-1', taskIdentifier: 'LUM-1' })
    ).resolves.toBe('')
  })

  it('task status has no securityFindings field and no SECURITY_FINDING rows', async () => {
    await expect(collectTaskStatusSections('t-1')).resolves.toEqual({
      nextActions: [],
      fields: {},
    })
    const report = await taskStatusService.statusForTask('t-1')
    expect(report).not.toHaveProperty('securityFindings')
    expect(report.nextActions.map(a => a.kind)).not.toContain(
      'SECURITY_FINDING'
    )
  })

  it('the PreToolUse hook serves no securityReminder', async () => {
    await expect(
      collectPreToolUseReminders({ sessionId: 's-1', taskId: 't-1' })
    ).resolves.toEqual({})
    ;(authService.verifyApiKey as jest.Mock).mockResolvedValue({
      user: { id: 'clerk_1', email: 'a@b', name: 'A' },
      workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
      apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
    })
    ;(hookEventService.recordHookEvent as jest.Mock).mockResolvedValue({
      id: 'he_1',
      sessionId: 'sess_1',
      taskId: 't-1',
      toolName: 'Edit',
      filePath: 'a.ts',
    })
    const res = await preToolUse(
      new Request('http://x/api/hooks/pre-tool-use', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer lum_ok',
        },
        body: JSON.stringify({ session_id: 'sess_1', tool_name: 'Edit' }),
      })
    )
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('events', () => {
  it('PR, push and link events start nothing', () => {
    emitCoreEvent('github.pullRequest', {
      workspaceId: 'w-1',
      taskId: 't-1',
      pullRequestId: 'pr-1',
      action: 'synchronize',
      state: 'open',
      repo: 'acme/app',
      prNumber: 1,
      isDraft: false,
    })
    emitCoreEvent('github.push', {
      workspaceId: 'w-1',
      repo: 'o/r',
      branch: 'main',
      isDefaultBranch: true,
      headSha: 'abc',
    })
    emitCoreEvent('task.prLinked', { taskId: 't-1', pullRequestId: 'pr-1' })
  })
})

describe('retention', () => {
  it('the stock script only knows the core categories', async () => {
    expect(retentionStockCategories()).toEqual(['crossing-raw', 'dead-letter'])
    expect(isRetentionStockCategory('scan-evidence')).toBe(false)
    expect(isRetentionStockCategory('dead-letter')).toBe(true)
    await expect(retentionStockService.plan('scan-evidence')).rejects.toThrow(
      'unknown retention-stock category: scan-evidence'
    )
  })

  it('losing GitHub access scrubs no plugin data', async () => {
    await expect(
      scrubPluginRepositoryCode({ workspaceId: 'w-1', repos: ['o/r'] })
    ).resolves.toEqual({})
  })
})
