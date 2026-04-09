/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    findByWorkspace: jest.fn(),
    findById: jest.fn(),
    findByName: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    syncTaskTags: jest.fn(),
    syncDocumentTags: jest.fn(),
    findByTask: jest.fn(),
    findByDocument: jest.fn(),
  },
}))

import { tagRepository } from '@/lib/repositories/tag.repository'
import { tagService } from '@/lib/services/tag.service'

const repo = tagRepository as jest.Mocked<typeof tagRepository>

beforeEach(() => jest.clearAllMocks())

describe('tagService.listTags', () => {
  it('delegates to repository', async () => {
    const tags = [{ id: 't1', name: 'backend', workspaceId: 'ws-1' }]
    repo.findByWorkspace.mockResolvedValue(tags as never)

    const result = await tagService.listTags('ws-1')
    expect(result).toEqual(tags)
    expect(repo.findByWorkspace).toHaveBeenCalledWith('ws-1')
  })
})

describe('tagService.createTag', () => {
  it('creates a tag when name is unique', async () => {
    repo.findByName.mockResolvedValue(null)
    const tag = {
      id: 't1',
      name: 'new-tag',
      color: null,
      workspaceId: 'ws-1',
      createdAt: new Date(),
    }
    repo.create.mockResolvedValue(tag)

    const result = await tagService.createTag('ws-1', { name: 'new-tag' })
    expect(result).toEqual(tag)
  })

  it('throws 409 when name already exists', async () => {
    repo.findByName.mockResolvedValue({ id: 'existing' } as never)

    await expect(
      tagService.createTag('ws-1', { name: 'existing-tag' })
    ).rejects.toMatchObject({ message: 'Tag name already exists', status: 409 })
  })
})

describe('tagService.updateTag', () => {
  it('updates a tag in the same workspace', async () => {
    repo.findById.mockResolvedValue({
      id: 't1',
      name: 'old',
      workspaceId: 'ws-1',
    } as never)
    repo.findByName.mockResolvedValue(null)
    const updated = {
      id: 't1',
      name: 'new',
      color: null,
      workspaceId: 'ws-1',
      createdAt: new Date(),
    }
    repo.update.mockResolvedValue(updated)

    const result = await tagService.updateTag('t1', 'ws-1', { name: 'new' })
    expect(result).toEqual(updated)
  })

  it('throws 404 when tag not found', async () => {
    repo.findById.mockResolvedValue(null)

    await expect(
      tagService.updateTag('nonexistent', 'ws-1', { name: 'new' })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 404 when tag belongs to different workspace', async () => {
    repo.findById.mockResolvedValue({
      id: 't1',
      name: 'old',
      workspaceId: 'ws-other',
    } as never)

    await expect(
      tagService.updateTag('t1', 'ws-1', { name: 'new' })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 409 when new name conflicts', async () => {
    repo.findById.mockResolvedValue({
      id: 't1',
      name: 'old',
      workspaceId: 'ws-1',
    } as never)
    repo.findByName.mockResolvedValue({ id: 't2' } as never)

    await expect(
      tagService.updateTag('t1', 'ws-1', { name: 'conflict' })
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('tagService.deleteTag', () => {
  it('deletes a tag', async () => {
    repo.findById.mockResolvedValue({
      id: 't1',
      workspaceId: 'ws-1',
    } as never)
    repo.delete.mockResolvedValue(undefined)

    await tagService.deleteTag('t1', 'ws-1')
    expect(repo.delete).toHaveBeenCalledWith('t1')
  })

  it('throws 404 when tag not found', async () => {
    repo.findById.mockResolvedValue(null)

    await expect(
      tagService.deleteTag('nonexistent', 'ws-1')
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('tagService.syncTaskTags', () => {
  it('delegates to repository', async () => {
    repo.syncTaskTags.mockResolvedValue(undefined)

    await tagService.syncTaskTags('task-1', ['t1', 't2'])
    expect(repo.syncTaskTags).toHaveBeenCalledWith('task-1', ['t1', 't2'])
  })
})

describe('tagService.syncDocumentTags', () => {
  it('delegates to repository', async () => {
    repo.syncDocumentTags.mockResolvedValue(undefined)

    await tagService.syncDocumentTags('doc-1', ['t1'])
    expect(repo.syncDocumentTags).toHaveBeenCalledWith('doc-1', ['t1'])
  })
})
