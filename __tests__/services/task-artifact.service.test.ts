/** @jest-environment node */
jest.mock('@/lib/repositories/task-artifact.repository', () => ({
  taskArtifactRepository: {
    create: jest.fn(),
    listByTask: jest.fn(),
    countByTask: jest.fn(),
  },
}))

import { taskArtifactRepository } from '@/lib/repositories/task-artifact.repository'
import { taskArtifactService } from '@/lib/services/task-artifact.service'

const repo = taskArtifactRepository as unknown as {
  create: jest.Mock
  listByTask: jest.Mock
  countByTask: jest.Mock
}

describe('taskArtifactService.addArtifact', () => {
  beforeEach(() => jest.clearAllMocks())

  it('appends at order = current count', async () => {
    repo.countByTask.mockResolvedValue(2)
    repo.create.mockResolvedValue({ id: 'a3' })
    await taskArtifactService.addArtifact({
      taskId: 't1',
      workspaceId: 'w1',
      kind: 'plan',
      title: 'Plan',
      content: '1. step',
      source: 'superpowers',
      actorMemberId: 'm1',
    })
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        order: 2,
        createdById: 'm1',
        source: 'superpowers',
      })
    )
  })

  it("defaults source to 'claude-code' when omitted", async () => {
    repo.countByTask.mockResolvedValue(0)
    repo.create.mockResolvedValue({ id: 'a1' })
    await taskArtifactService.addArtifact({
      taskId: 't1',
      workspaceId: 'w1',
      kind: 'spec',
      title: 'Spec',
      content: 'x',
      source: undefined,
      actorMemberId: null,
    })
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'claude-code',
        order: 0,
        createdById: null,
      })
    )
  })
})
