/** @jest-environment node */
jest.mock('@/lib/repositories/task-artifact.repository', () => ({
  taskArtifactRepository: {
    create: jest.fn(),
    listByTask: jest.fn(),
    countByTask: jest.fn(),
    findById: jest.fn(),
    deleteById: jest.fn(),
    updateById: jest.fn(),
  },
}))

import { taskArtifactRepository } from '@/lib/repositories/task-artifact.repository'
import { taskArtifactService } from '@/lib/services/task-artifact.service'

const repo = taskArtifactRepository as unknown as {
  create: jest.Mock
  listByTask: jest.Mock
  countByTask: jest.Mock
  findById: jest.Mock
  deleteById: jest.Mock
  updateById: jest.Mock
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
      agent: 'CURSOR',
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

  it('forwards agent to the repo', async () => {
    repo.countByTask.mockResolvedValue(0)
    repo.create.mockResolvedValue({ id: 'a1' })
    await taskArtifactService.addArtifact({
      taskId: 't1',
      workspaceId: 'w1',
      kind: 'spec',
      title: 'Spec',
      content: 'x',
      source: 'superpowers',
      agent: 'CURSOR',
      actorMemberId: 'm1',
    })
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'CURSOR' })
    )
  })

  it('passes source through verbatim (no default)', async () => {
    repo.countByTask.mockResolvedValue(0)
    repo.create.mockResolvedValue({ id: 'a1' })
    await taskArtifactService.addArtifact({
      taskId: 't1',
      workspaceId: 'w1',
      kind: 'spec',
      title: 'Spec',
      content: 'x',
      source: 'gsd',
      agent: 'CLAUDE_CODE',
      actorMemberId: null,
    })
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'gsd',
        order: 0,
        createdById: null,
      })
    )
  })
})

describe('taskArtifactService.updateArtifact', () => {
  beforeEach(() => jest.clearAllMocks())

  it('patches and returns the refreshed artifact', async () => {
    repo.updateById.mockResolvedValue(1)
    repo.findById.mockResolvedValue({ id: 'a1', kind: 'plan', source: 'gsd' })
    const out = await taskArtifactService.updateArtifact('t1', 'a1', {
      kind: 'plan',
      source: 'gsd',
    })
    expect(repo.updateById).toHaveBeenCalledWith('a1', 't1', {
      kind: 'plan',
      source: 'gsd',
    })
    expect(out).toEqual({ id: 'a1', kind: 'plan', source: 'gsd' })
  })

  it('throws 404 when no row matched', async () => {
    repo.updateById.mockResolvedValue(0)
    await expect(
      taskArtifactService.updateArtifact('t1', 'a1', { kind: 'plan' })
    ).rejects.toMatchObject({ status: 404, message: 'Artifact not found' })
    expect(repo.findById).not.toHaveBeenCalled()
  })
})

describe('taskArtifactService.getById', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns the artifact when it exists', async () => {
    repo.findById.mockResolvedValue({ id: 'a1', title: 'Spec' })
    const out = await taskArtifactService.getById('t1', 'a1')
    expect(repo.findById).toHaveBeenCalledWith('a1', 't1')
    expect(out).toEqual({ id: 'a1', title: 'Spec' })
  })

  it('throws 404 when the artifact is missing', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(taskArtifactService.getById('t1', 'a1')).rejects.toMatchObject(
      {
        status: 404,
        message: 'Artifact not found',
      }
    )
  })
})

describe('taskArtifactService.removeArtifact', () => {
  beforeEach(() => jest.clearAllMocks())

  it('resolves when a row was deleted', async () => {
    repo.deleteById.mockResolvedValue(1)
    await expect(
      taskArtifactService.removeArtifact('t1', 'a1')
    ).resolves.toBeUndefined()
    expect(repo.deleteById).toHaveBeenCalledWith('a1', 't1')
  })

  it('throws 404 when no row matched', async () => {
    repo.deleteById.mockResolvedValue(0)
    await expect(
      taskArtifactService.removeArtifact('t1', 'a1')
    ).rejects.toMatchObject({
      status: 404,
      message: 'Artifact not found',
    })
  })
})
