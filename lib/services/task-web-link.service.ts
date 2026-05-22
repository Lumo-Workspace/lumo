import { taskWebLinkRepository } from '@/lib/repositories/task-web-link.repository'
import { fetchOpenGraph } from '@/lib/integrations/og-metadata/fetch'

function err(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status })
}

function normalizeUrl(raw: string): { url: string; domain: string } {
  const u = new URL(raw.trim())
  u.protocol = u.protocol.toLowerCase()
  u.hostname = u.hostname.toLowerCase()
  u.hash = ''
  return { url: u.toString(), domain: u.hostname }
}

export interface AddWebLinkInput {
  taskId: string
  workspaceId: string
  url: string
  note?: string
  actorMemberId: string
}

export const taskWebLinkService = {
  async listForTask(taskId: string) {
    return taskWebLinkRepository.listByTask(taskId)
  },

  async addWebLink(input: AddWebLinkInput) {
    const { url, domain } = normalizeUrl(input.url)
    const og = await fetchOpenGraph(url)

    const payload = og.ok
      ? {
          taskId: input.taskId,
          workspaceId: input.workspaceId,
          url,
          domain,
          title: og.data.title ?? null,
          description: og.data.description ?? null,
          note: input.note ?? null,
          imageUrl: og.data.imageUrl ?? null,
          faviconUrl: og.data.faviconUrl ?? null,
          fetchedAt: new Date(),
          fetchError: null,
          createdById: input.actorMemberId,
        }
      : {
          taskId: input.taskId,
          workspaceId: input.workspaceId,
          url,
          domain,
          title: null,
          description: null,
          note: input.note ?? null,
          imageUrl: null,
          faviconUrl: null,
          fetchedAt: null,
          fetchError: og.error,
          createdById: input.actorMemberId,
        }

    return taskWebLinkRepository.create(payload)
  },

  async refreshWebLink(linkId: string, expectedWorkspaceId: string) {
    const link = await taskWebLinkRepository.getById(linkId)
    if (!link || link.task.project.workspaceId !== expectedWorkspaceId) {
      throw err('not_found', 404)
    }
    const og = await fetchOpenGraph(link.url)
    if (og.ok) {
      return taskWebLinkRepository.updateFetch(linkId, {
        ok: true,
        title: og.data.title,
        description: og.data.description,
        imageUrl: og.data.imageUrl,
        faviconUrl: og.data.faviconUrl,
      })
    }
    return taskWebLinkRepository.updateFetch(linkId, {
      ok: false,
      error: og.error,
    })
  },

  async unlinkWebLink(linkId: string, expectedWorkspaceId: string) {
    const link = await taskWebLinkRepository.getById(linkId)
    if (!link || link.task.project.workspaceId !== expectedWorkspaceId) {
      throw err('not_found', 404)
    }
    await taskWebLinkRepository.delete(linkId)
  },
}
