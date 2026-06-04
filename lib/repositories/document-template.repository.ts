import { prisma } from '@/lib/db/prisma'

export const documentTemplateRepository = {
  /**
   * Templates visible to a workspace: global system templates
   * (workspaceId null) plus any owned by this workspace.
   */
  async listVisible(workspaceId: string) {
    return prisma.documentTemplate.findMany({
      where: { OR: [{ workspaceId: null }, { workspaceId }] },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        key: true,
        emoji: true,
        content: true,
        sortOrder: true,
      },
    })
  },

  /** Find a single template by id (no visibility filter — caller checks). */
  async findById(id: string) {
    return prisma.documentTemplate.findUnique({ where: { id } })
  },
}
