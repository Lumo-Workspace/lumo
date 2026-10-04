import { prisma } from '@/lib/db/prisma'

const select = {
  id: true,
  key: true,
  name: true,
  content: true,
  updatedAt: true,
} as const

/** LUM-970: workspace-owned task templates (system ones live in code). */
export const taskTemplateRepository = {
  async listByWorkspace(workspaceId: string) {
    return prisma.taskTemplate.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      select,
    })
  },

  async findByKey(workspaceId: string, key: string) {
    return prisma.taskTemplate.findUnique({
      where: { workspaceId_key: { workspaceId, key } },
      select,
    })
  },

  /** Scoped to the workspace so another workspace's id reads as missing. */
  async findInWorkspace(workspaceId: string, id: string) {
    return prisma.taskTemplate.findFirst({
      where: { id, workspaceId },
      select,
    })
  },

  async create(data: {
    workspaceId: string
    key: string
    name: string
    content: string
  }) {
    return prisma.taskTemplate.create({ data, select })
  },

  async update(
    id: string,
    data: {
      key?: string | undefined
      name?: string | undefined
      content?: string | undefined
    }
  ) {
    const patch: { key?: string; name?: string; content?: string } = {}
    if (data.key !== undefined) patch.key = data.key
    if (data.name !== undefined) patch.name = data.name
    if (data.content !== undefined) patch.content = data.content
    return prisma.taskTemplate.update({ where: { id }, data: patch, select })
  },

  async delete(id: string) {
    await prisma.taskTemplate.delete({ where: { id } })
  },
}
