/**
 * @jest-environment node
 *
 * LUM-970: `task decide` writes through the normal CLI update path.
 */
jest.mock('@/lib/services/task.service', () => ({
  taskService: { resolveIdentifier: jest.fn() },
}))
jest.mock('@/lib/services/task-cli.service', () => ({
  taskCliService: { updateFromCli: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findDescription: jest.fn() },
}))

import { taskService } from '@/lib/services/task.service'
import { taskCliService } from '@/lib/services/task-cli.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { taskDecisionService } from '@/lib/services/task-decision.service'

const args = {
  workspaceId: 'ws_1',
  workspaceSlug: 'lumo',
  callerClerkId: 'clerk_1',
  identifier: 'LUM-42',
  text: '2026-10-04 keep v1',
  sourceSessionId: 'sess_1',
}

beforeEach(() => jest.clearAllMocks())

describe('taskDecisionService.appendToTask', () => {
  it('appends to the Decisions section and saves via updateFromCli', async () => {
    ;(taskService.resolveIdentifier as jest.Mock).mockResolvedValue({
      id: 'task_42',
    })
    ;(taskRepository.findDescription as jest.Mock).mockResolvedValue({
      description: '<h2>Decisions</h2><ul><li><p>old</p></li></ul>',
    })
    ;(taskCliService.updateFromCli as jest.Mock).mockResolvedValue({
      identifier: 'LUM-42',
    })
    await taskDecisionService.appendToTask(args)
    expect(taskCliService.updateFromCli).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      workspaceSlug: 'lumo',
      callerClerkId: 'clerk_1',
      identifier: 'LUM-42',
      sourceSessionId: 'sess_1',
      input: {
        description:
          '<h2>Decisions</h2><ul><li><p>old</p></li><li><p>2026-10-04 keep v1</p></li></ul>',
      },
    })
  })

  it('404s an unknown task without writing', async () => {
    ;(taskService.resolveIdentifier as jest.Mock).mockResolvedValue(null)
    await expect(taskDecisionService.appendToTask(args)).rejects.toMatchObject({
      status: 404,
    })
    expect(taskCliService.updateFromCli).not.toHaveBeenCalled()
  })
})
