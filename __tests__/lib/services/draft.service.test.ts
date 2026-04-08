/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/draft.repository', () => ({
  draftRepository: {
    findByWorkspaceAndCreator: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}))

import { draftRepository } from '@/lib/repositories/draft.repository'
import { draftService } from '@/lib/services/draft.service'

const mockFindByWorkspaceAndCreator =
  draftRepository.findByWorkspaceAndCreator as jest.Mock
const mockFindById = draftRepository.findById as jest.Mock
const mockCreate = draftRepository.create as jest.Mock
const mockUpdate = draftRepository.update as jest.Mock
const mockDelete = draftRepository.delete as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('draftService.listDrafts', () => {
  it('delegates to repository', async () => {
    const drafts = [{ id: 'd1' }]
    mockFindByWorkspaceAndCreator.mockResolvedValue(drafts)

    const result = await draftService.listDrafts('ws-1', 'actor-1')

    expect(result).toEqual(drafts)
    expect(mockFindByWorkspaceAndCreator).toHaveBeenCalledWith(
      'ws-1',
      'actor-1'
    )
  })
})

describe('draftService.upsertDraft', () => {
  it('creates a new draft when no id provided', async () => {
    const created = { id: 'd1', type: 'TASK', data: { title: 'New' } }
    mockCreate.mockResolvedValue(created)

    const result = await draftService.upsertDraft({
      workspaceId: 'ws-1',
      creatorId: 'actor-1',
      type: 'TASK',
      data: { title: 'New' },
    })

    expect(result).toEqual(created)
    expect(mockCreate).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      creatorId: 'actor-1',
      type: 'TASK',
      data: { title: 'New' },
    })
  })

  it('updates existing draft when id is provided and owned', async () => {
    mockFindById.mockResolvedValue({ id: 'd1', creatorId: 'actor-1' })
    const updated = { id: 'd1', type: 'PROJECT', data: { name: 'Updated' } }
    mockUpdate.mockResolvedValue(updated)

    const result = await draftService.upsertDraft({
      id: 'd1',
      workspaceId: 'ws-1',
      creatorId: 'actor-1',
      type: 'PROJECT',
      data: { name: 'Updated' },
    })

    expect(result).toEqual(updated)
    expect(mockUpdate).toHaveBeenCalledWith('d1', {
      type: 'PROJECT',
      data: { name: 'Updated' },
    })
  })

  it('throws 404 when updating a draft not owned by creator', async () => {
    mockFindById.mockResolvedValue({ id: 'd1', creatorId: 'other-actor' })

    await expect(
      draftService.upsertDraft({
        id: 'd1',
        workspaceId: 'ws-1',
        creatorId: 'actor-1',
        type: 'TASK',
        data: {},
      })
    ).rejects.toMatchObject({ message: 'Draft not found', status: 404 })
  })

  it('throws 404 when updating a nonexistent draft', async () => {
    mockFindById.mockResolvedValue(null)

    await expect(
      draftService.upsertDraft({
        id: 'nonexistent',
        workspaceId: 'ws-1',
        creatorId: 'actor-1',
        type: 'TASK',
        data: {},
      })
    ).rejects.toMatchObject({ message: 'Draft not found', status: 404 })
  })
})

describe('draftService.deleteDraft', () => {
  it('deletes draft when owned by creator', async () => {
    mockFindById.mockResolvedValue({ id: 'd1', creatorId: 'actor-1' })
    mockDelete.mockResolvedValue({ id: 'd1' })

    await draftService.deleteDraft('d1', 'actor-1')

    expect(mockDelete).toHaveBeenCalledWith('d1')
  })

  it('throws 404 when draft not found', async () => {
    mockFindById.mockResolvedValue(null)

    await expect(
      draftService.deleteDraft('nonexistent', 'actor-1')
    ).rejects.toMatchObject({ message: 'Draft not found', status: 404 })
  })

  it('throws 404 when draft not owned by creator', async () => {
    mockFindById.mockResolvedValue({ id: 'd1', creatorId: 'other-actor' })

    await expect(
      draftService.deleteDraft('d1', 'actor-1')
    ).rejects.toMatchObject({ message: 'Draft not found', status: 404 })
  })
})
