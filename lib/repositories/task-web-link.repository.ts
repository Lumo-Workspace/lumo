import { prisma } from '@/lib/db/prisma'
import type { ContentSignals } from '@/shared/src/untrusted-content'
import { contentSignalsData } from './content-signals-column'

export interface CreateTaskWebLinkInput {
  taskId: string
  workspaceId: string // denormalized for workspace-scoped queries; mirrors TaskSlackContext
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
  /** LUM-783: scan of title/description; null = clean, omit = not scanned. */
  contentSignals?: ContentSignals | null
}

export type UpdateFetchInput =
  | {
      ok: true
      title: string | null | undefined
      description: string | null | undefined
      imageUrl: string | null | undefined
      faviconUrl: string | null | undefined
      /** LUM-783: scan of the refreshed metadata (+ stored note/body). */
      contentSignals?: ContentSignals | null
    }
  | { ok: false; error: string }

export const taskWebLinkRepository = {
  async create(input: CreateTaskWebLinkInput) {
    const { contentSignals, ...rest } = input
    return prisma.taskWebLink.create({
      data: { ...rest, ...contentSignalsData(contentSignals) },
    })
  },

  async listByTask(taskId: string) {
    return prisma.taskWebLink.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
    })
  },

  async getById(id: string) {
    return prisma.taskWebLink.findUnique({
      where: { id },
      include: {
        task: { select: { project: { select: { workspaceId: true } } } },
      },
    })
  },

  async updateFetch(id: string, fetch: UpdateFetchInput) {
    if (fetch.ok) {
      return prisma.taskWebLink.update({
        where: { id },
        data: {
          title: fetch.title ?? null,
          description: fetch.description ?? null,
          imageUrl: fetch.imageUrl ?? null,
          faviconUrl: fetch.faviconUrl ?? null,
          fetchedAt: new Date(),
          fetchError: null,
          ...contentSignalsData(fetch.contentSignals),
        },
      })
    }
    return prisma.taskWebLink.update({
      where: { id },
      data: { fetchError: fetch.error },
    })
  },

  async updateBody(
    id: string,
    body: string,
    /** LUM-783: scan of the fetched body (+ stored metadata). */
    contentSignals?: ContentSignals | null
  ) {
    return prisma.taskWebLink.update({
      where: { id },
      data: {
        body,
        bodyFetchedAt: new Date(),
        ...contentSignalsData(contentSignals),
      },
    })
  },

  async delete(id: string) {
    return prisma.taskWebLink.delete({ where: { id } })
  },
}
