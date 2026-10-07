const auditForTask = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/services/lineage/fragment-usage-audit.service', () => ({
  fragmentUsageAuditService: {
    auditForTask: (...a: unknown[]) => auditForTask(...a),
  },
}))
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => p,
}))

import { dispatchDoneAudit } from '@/lib/services/task-state.service'

it('dispatchDoneAudit triggers the usage audit for the task', async () => {
  await dispatchDoneAudit('task1')
  // dynamic import + call resolves on the next microtasks; flush the queue
  await Promise.resolve()
  await Promise.resolve()
  expect(auditForTask).toHaveBeenCalledWith('task1')
})
