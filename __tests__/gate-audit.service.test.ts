import { gateAuditService } from '@/lib/services/gate-audit.service'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'

jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { findByTaskId: jest.fn() },
}))

const findByTaskId = hookEventRepository.findByTaskId as jest.Mock

describe('gateAuditService.getForTask', () => {
  it('builds the delivery audit from the task hook-event rows', async () => {
    findByTaskId.mockResolvedValue([
      {
        type: 'POST_TOOL_USE',
        payload: { tool_name: 'Bash', tool_input: { command: 'tsc --noEmit' } },
        createdAt: new Date('2026-06-27T10:00:00.000Z'),
      },
      {
        type: 'POST_TOOL_USE_FAILURE',
        payload: { tool_name: 'Bash', tool_input: { command: 'npm test' } },
        createdAt: new Date('2026-06-27T10:05:00.000Z'),
      },
    ])

    const audit = await gateAuditService.getForTask('task_1')
    const byKey = Object.fromEntries(audit.gates.map(g => [g.key, g]))

    expect(findByTaskId).toHaveBeenCalledWith('task_1')
    expect(byKey['typecheck']!.status).toBe('passed')
    expect(byKey['test']!.status).toBe('failed')
    expect(byKey['build']!.status).toBe('not_run')
    expect(byKey['diff-scope']!.status).toBe('not_configured')
  })
})
