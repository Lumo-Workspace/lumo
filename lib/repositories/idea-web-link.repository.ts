import { prisma } from '@/lib/db/prisma'

export interface CreateIdeaWebLinkInput {
  ideaId: string
  workspaceId: string // denormalized for workspace-scoped queries; mirrors IdeaSlackContext
  url: string
  domain: string
  title: string | null
  description: string | null
  note: string | null
  imageUrl: string | null
  faviconUrl: string | null
  fetchedAt: Date | null
  fetchError: string | null
  createdById: string // WorkspaceMember.id
}

export type UpdateFetchInput =
  | {
      ok: true
      title: string | null | undefined
      description: string | null | undefined
      imageUrl: string | null | undefined
      faviconUrl: string | null | undefined
    }
  | { ok: false; error: string }

export const ideaWebLinkRepository = {
  async create(input: CreateIdeaWebLinkInput) {
    return prisma.ideaWebLink.create({ data: input })
  },

  async listByIdea(ideaId: string) {
    return prisma.ideaWebLink.findMany({
      where: { ideaId },
      orderBy: { createdAt: 'desc' },
    })
  },

  async getById(id: string) {
    return prisma.ideaWebLink.findUnique({ where: { id } })
  },

  async updateFetch(id: string, fetch: UpdateFetchInput) {
    if (fetch.ok) {
      return prisma.ideaWebLink.update({
        where: { id },
        data: {
          title: fetch.title ?? null,
          description: fetch.description ?? null,
          imageUrl: fetch.imageUrl ?? null,
          faviconUrl: fetch.faviconUrl ?? null,
          fetchedAt: new Date(),
          fetchError: null,
        },
      })
    }
    return prisma.ideaWebLink.update({
      where: { id },
      data: { fetchError: fetch.error },
    })
  },

  async updateBody(id: string, body: string) {
    return prisma.ideaWebLink.update({
      where: { id },
      data: { body, bodyFetchedAt: new Date() },
    })
  },

  async delete(id: string) {
    return prisma.ideaWebLink.delete({ where: { id } })
  },
}
