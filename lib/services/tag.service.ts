import { tagRepository } from '@/lib/repositories/tag.repository'

export interface CreateTagInput {
  name: string
  color?: string | undefined
}

export interface UpdateTagInput {
  name?: string | undefined
  color?: string | null | undefined
}

export const tagService = {
  /** List all tags in a workspace. */
  async listTags(workspaceId: string) {
    return tagRepository.findByWorkspace(workspaceId)
  },

  /** Create a tag in a workspace. Throws 409 if name already exists. */
  async createTag(workspaceId: string, input: CreateTagInput) {
    const existing = await tagRepository.findByName(workspaceId, input.name)
    if (existing) {
      throw Object.assign(new Error('Tag name already exists'), { status: 409 })
    }

    return tagRepository.create({
      name: input.name,
      color: input.color ?? null,
      workspaceId,
    })
  },

  /** Update a tag. Throws 404 if not found, 403 if wrong workspace, 409 if name conflict. */
  async updateTag(tagId: string, workspaceId: string, input: UpdateTagInput) {
    const tag = await tagRepository.findById(tagId)
    if (!tag) {
      throw Object.assign(new Error('Tag not found'), { status: 404 })
    }
    if (tag.workspaceId !== workspaceId) {
      throw Object.assign(new Error('Tag not found'), { status: 404 })
    }

    if (input.name && input.name !== tag.name) {
      const conflict = await tagRepository.findByName(workspaceId, input.name)
      if (conflict) {
        throw Object.assign(new Error('Tag name already exists'), {
          status: 409,
        })
      }
    }

    return tagRepository.update(tagId, input)
  },

  /** Delete a tag. Throws 404 if not found or wrong workspace. */
  async deleteTag(tagId: string, workspaceId: string) {
    const tag = await tagRepository.findById(tagId)
    if (!tag) {
      throw Object.assign(new Error('Tag not found'), { status: 404 })
    }
    if (tag.workspaceId !== workspaceId) {
      throw Object.assign(new Error('Tag not found'), { status: 404 })
    }

    await tagRepository.delete(tagId)
  },

  /** Sync tagIds for a task. */
  async syncTaskTags(taskId: string, tagIds: string[]) {
    await tagRepository.syncTaskTags(taskId, tagIds)
  },

  /** Sync tagIds for a document. */
  async syncDocumentTags(documentId: string, tagIds: string[]) {
    await tagRepository.syncDocumentTags(documentId, tagIds)
  },

  /** Get tags for a task. */
  async getTaskTags(taskId: string) {
    return tagRepository.findByTask(taskId)
  },

  /** Get tags for a document. */
  async getDocumentTags(documentId: string) {
    return tagRepository.findByDocument(documentId)
  },
}
