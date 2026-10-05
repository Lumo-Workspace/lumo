import { prisma } from '@/lib/db/prisma'

export const tagRepository = {
  /** Find all tags in a workspace. */
  async findByWorkspace(workspaceId: string) {
    return prisma.tag.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
      include: {
        // LUM-923: usage counts leave out tasks / documents in the trash.
        _count: {
          select: {
            taskTags: { where: { task: { deletedAt: null } } },
            documentTags: { where: { document: { deletedAt: null } } },
          },
        },
      },
    })
  },

  /** Find a tag by ID. */
  async findById(id: string) {
    return prisma.tag.findUnique({ where: { id } })
  },

  /**
   * Which of `ids` are tags in `workspaceId` — for validating caller-supplied
   * tag ids before attaching them (LUM-994). Another workspace's id reads as
   * missing.
   */
  async findIdsInWorkspace(ids: string[], workspaceId: string) {
    if (ids.length === 0) return []
    return prisma.tag.findMany({
      where: { id: { in: ids }, workspaceId },
      select: { id: true },
    })
  },

  /** Find a tag by workspace + name (case-sensitive). */
  async findByName(workspaceId: string, name: string) {
    return prisma.tag.findUnique({
      where: { workspaceId_name: { workspaceId, name } },
    })
  },

  /** Create a tag. */
  async create(data: {
    name: string
    color?: string | null
    workspaceId: string
  }) {
    return prisma.tag.create({
      data: {
        name: data.name,
        color: data.color ?? null,
        workspaceId: data.workspaceId,
      },
    })
  },

  /** Update a tag. */
  async update(
    id: string,
    data: { name?: string | undefined; color?: string | null | undefined }
  ) {
    const updateData: Record<string, unknown> = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.color !== undefined) updateData.color = data.color
    return prisma.tag.update({ where: { id }, data: updateData })
  },

  /** Delete a tag (cascades to TaskTag + DocumentTag). */
  async delete(id: string) {
    await prisma.tag.delete({ where: { id } })
  },

  /**
   * Find or create tags by name in a workspace.
   * Returns all matching Tag records.
   */
  async findOrCreateMany(workspaceId: string, names: string[]) {
    if (names.length === 0) return []

    return prisma.$transaction(async tx => {
      const existing = await tx.tag.findMany({
        where: { workspaceId, name: { in: names } },
      })
      const existingNames = new Set(existing.map(t => t.name))
      const toCreate = names.filter(n => !existingNames.has(n))

      if (toCreate.length > 0) {
        await tx.tag.createMany({
          data: toCreate.map(name => ({ name, workspaceId })),
          skipDuplicates: true,
        })
      }

      return tx.tag.findMany({
        where: { workspaceId, name: { in: names } },
      })
    })
  },

  /** Sync tag associations for a task. Performs diff: adds new, removes old. */
  async syncTaskTags(taskId: string, tagIds: string[]) {
    return prisma.$transaction(async tx => {
      const existing = await tx.taskTag.findMany({
        where: { taskId },
        select: { tagId: true },
      })
      const existingSet = new Set(existing.map(t => t.tagId))
      const newSet = new Set(tagIds)

      const toDelete = [...existingSet].filter(id => !newSet.has(id))
      const toCreate = [...newSet].filter(id => !existingSet.has(id))

      if (toDelete.length > 0) {
        await tx.taskTag.deleteMany({
          where: { taskId, tagId: { in: toDelete } },
        })
      }
      if (toCreate.length > 0) {
        await tx.taskTag.createMany({
          data: toCreate.map(tagId => ({ taskId, tagId })),
        })
      }
    })
  },

  /** Incrementally attach tags to a task. Skips already-attached tags (idempotent). */
  async addTaskTags(taskId: string, tagIds: string[]): Promise<void> {
    if (tagIds.length === 0) return
    await prisma.taskTag.createMany({
      data: tagIds.map(tagId => ({ taskId, tagId })),
      skipDuplicates: true,
    })
  },

  /** Incrementally detach tags from a task. Silently ignores unattached tags. */
  async removeTaskTags(taskId: string, tagIds: string[]): Promise<void> {
    if (tagIds.length === 0) return
    await prisma.taskTag.deleteMany({
      where: { taskId, tagId: { in: tagIds } },
    })
  },

  /** Sync tag associations for a document. Performs diff: adds new, removes old. */
  async syncDocumentTags(documentId: string, tagIds: string[]) {
    return prisma.$transaction(async tx => {
      const existing = await tx.documentTag.findMany({
        where: { documentId },
        select: { tagId: true },
      })
      const existingSet = new Set(existing.map(t => t.tagId))
      const newSet = new Set(tagIds)

      const toDelete = [...existingSet].filter(id => !newSet.has(id))
      const toCreate = [...newSet].filter(id => !existingSet.has(id))

      if (toDelete.length > 0) {
        await tx.documentTag.deleteMany({
          where: { documentId, tagId: { in: toDelete } },
        })
      }
      if (toCreate.length > 0) {
        await tx.documentTag.createMany({
          data: toCreate.map(tagId => ({ documentId, tagId })),
        })
      }
    })
  },

  /** Incrementally attach tags to a document. Skips already-attached tags (idempotent). */
  async addDocumentTags(documentId: string, tagIds: string[]): Promise<void> {
    if (tagIds.length === 0) return
    await prisma.documentTag.createMany({
      data: tagIds.map(tagId => ({ documentId, tagId })),
      skipDuplicates: true,
    })
  },

  /** Incrementally detach tags from a document. Silently ignores unattached tags. */
  async removeDocumentTags(
    documentId: string,
    tagIds: string[]
  ): Promise<void> {
    if (tagIds.length === 0) return
    await prisma.documentTag.deleteMany({
      where: { documentId, tagId: { in: tagIds } },
    })
  },

  /** Find tags for a task. */
  async findByTask(taskId: string) {
    const taskTags = await prisma.taskTag.findMany({
      where: { taskId },
      include: { tag: true },
    })
    return taskTags.map(tt => tt.tag)
  },

  /** Find tags for a document. */
  async findByDocument(documentId: string) {
    const docTags = await prisma.documentTag.findMany({
      where: { documentId },
      include: { tag: true },
    })
    return docTags.map(dt => dt.tag)
  },
}
