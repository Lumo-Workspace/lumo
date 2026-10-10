/**
 * @jest-environment node
 *
 * LUM-1061 — plugin task-status fields are appended to the report, and a
 * plugin can never replace a core field (version, task, nextActions…).
 */
const mockPlugin = {
  id: 'fake',
  register(api: import('@/lib/plugins/types').PluginRegistrar) {
    api.agentContext({
      id: 'fake',
      taskStatus: async () => ({
        nextActions: [{ kind: 'FAKE' }],
        // An own `__proto__` key (as JSON.parse makes one) must not reach
        // the report's prototype.
        fields: Object.assign(
          JSON.parse('{"__proto__": {"polluted": true}}') as object,
          {
            version: 99,
            nextActions: [],
            toString: 'x',
            fakeField: { ok: true },
          }
        ) as Record<string, unknown>,
      }),
    })
  },
}
jest.mock('@/lib/plugins/installed', () => ({
  get INSTALLED_SERVER_PLUGINS() {
    return [mockPlugin]
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

import { taskStatusService } from '@/lib/services/task-status.service'

it('appends plugin fields and rows without replacing core fields', async () => {
  const report = (await taskStatusService.statusForTask(
    't-1'
  )) as unknown as Record<string, unknown>
  expect(report.version).toBe(2)
  expect(report.fakeField).toEqual({ ok: true })
  expect((report.nextActions as Array<{ kind: string }>)[0]).toEqual({
    kind: 'FAKE',
  })
  expect(Object.getPrototypeOf(report)).toBe(Object.prototype)
  expect(report.polluted).toBeUndefined()
  // `toString` is not a core field: an own plugin field is fine.
  expect(report.toString).toBe('x')
  const keys = Object.keys(report)
  expect(keys.slice(-2)).toEqual(['toString', 'fakeField'])
})
