import { taskFigmaLinkRepository } from '@/lib/repositories/task-figma-link.repository'
import { figmaIntegrationRepository } from '@/lib/repositories/figma-integration.repository'
import { parseFigmaUrl } from '@/lib/integrations/figma/parse-url'
import {
  buildFigmaClient,
  pickRepresentativeFrame,
} from '@/lib/integrations/figma/build-client'
import type { TaskFigmaLink } from '@prisma/client'

const FRESHNESS_MS = 7 * 24 * 3600 * 1000

function err(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, code })
}

export const taskFigmaLinkService = {
  async addFigmaLink(input: {
    taskId: string
    workspaceId: string
    actorMemberId: string
    url: string
  }): Promise<TaskFigmaLink> {
    const parsed = parseFigmaUrl(input.url)
    if (!parsed) throw err('Not a Figma URL', 422)

    const fileKey = parsed.fileKey
    const nodeIdStored = parsed.nodeId ?? ''

    const existing = await taskFigmaLinkRepository.findByTaskAndKey(
      input.taskId,
      fileKey,
      nodeIdStored
    )
    if (
      existing &&
      Date.now() - existing.lastSyncedAt.getTime() < FRESHNESS_MS
    ) {
      return existing
    }

    const { client, integrationId } = await buildFigmaClient(
      input.workspaceId,
      input.actorMemberId
    )

    const file = await client.getFile(fileKey)
    let frameName: string | null = null
    let thumbnailNodeId: string | null = parsed.nodeId

    if (parsed.nodeId) {
      const nodeResp = await client.getNode(fileKey, parsed.nodeId)
      const node = nodeResp.nodes[parsed.nodeId]
      if (!node) throw err('Frame not found', 422)
      frameName = node.document.name
    } else {
      const pick = pickRepresentativeFrame(file)
      thumbnailNodeId = pick ? pick.id : null
    }

    let thumbnailUrl: string | null = null
    let lastSyncError: string | null = null
    if (thumbnailNodeId) {
      try {
        thumbnailUrl = await client.getImage(fileKey, thumbnailNodeId)
      } catch {
        lastSyncError = 'thumbnail_failed'
      }
    }

    if (existing) {
      return taskFigmaLinkRepository.update(existing.id, {
        fileName: file.name,
        frameName,
        thumbnailUrl,
        thumbnailFetchedAt: thumbnailUrl ? new Date() : null,
        lastSyncedAt: new Date(),
        lastSyncError,
        integrationId,
      })
    }

    return taskFigmaLinkRepository.create({
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      createdById: input.actorMemberId,
      integrationId,
      url: input.url,
      fileKey,
      nodeId: nodeIdStored,
      fileName: file.name,
      frameName,
      thumbnailUrl,
      thumbnailFetchedAt: thumbnailUrl ? new Date() : null,
      lastSyncError,
    })
  },

  async listForTask(taskId: string): Promise<TaskFigmaLink[]> {
    return taskFigmaLinkRepository.listByTask(taskId)
  },

  async removeFigmaLink(input: {
    input: string
    taskId: string
  }): Promise<void> {
    if (input.input.startsWith('cfl_')) {
      const row = await taskFigmaLinkRepository.findById(input.input)
      if (!row || row.taskId !== input.taskId) return
      await taskFigmaLinkRepository.delete(row.id)
      return
    }
    const parsed = parseFigmaUrl(input.input)
    if (!parsed) return
    const row = await taskFigmaLinkRepository.findByTaskAndKey(
      input.taskId,
      parsed.fileKey,
      parsed.nodeId ?? ''
    )
    if (!row) return
    await taskFigmaLinkRepository.delete(row.id)
  },

  /**
   * Background variant of `refreshLinksForTask` used by lazy refresh on
   * `task context`: picks any workspace member with a working Figma
   * integration to drive the API calls, so the refresh succeeds even when
   * the user loading the context hasn't personally connected Figma.
   * Returns `[]` when no workspace member has a usable integration.
   */
  async refreshLinksForTaskAuto(input: {
    taskId: string
    workspaceId: string
  }): Promise<Array<{ id: string; ok: boolean; error?: string }>> {
    const integration = await figmaIntegrationRepository.findAnyForWorkspace(
      input.workspaceId
    )
    if (!integration) return []
    return this.refreshLinksForTask({
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      actorMemberId: integration.memberId,
    })
  },

  async refreshLinksForTask(input: {
    taskId: string
    workspaceId: string
    actorMemberId: string
  }): Promise<Array<{ id: string; ok: boolean; error?: string }>> {
    const links = await taskFigmaLinkRepository.listByTask(input.taskId)
    if (links.length === 0) return []

    const { client, integrationId } = await buildFigmaClient(
      input.workspaceId,
      input.actorMemberId
    )

    return Promise.all(
      links.map(async link => {
        try {
          const file = await client.getFile(link.fileKey)
          let frameName: string | null = null
          let thumbnailNodeId: string | null = link.nodeId || null
          if (link.nodeId) {
            const node = await client.getNode(link.fileKey, link.nodeId)
            frameName = node.nodes[link.nodeId]?.document.name ?? null
          } else {
            const pick = pickRepresentativeFrame(file)
            thumbnailNodeId = pick ? pick.id : null
          }
          let thumbnailUrl: string | null = null
          let lastSyncError: string | null = null
          if (thumbnailNodeId) {
            try {
              thumbnailUrl = await client.getImage(
                link.fileKey,
                thumbnailNodeId
              )
            } catch {
              lastSyncError = 'thumbnail_failed'
            }
          }
          await taskFigmaLinkRepository.update(link.id, {
            fileName: file.name,
            frameName,
            thumbnailUrl,
            thumbnailFetchedAt: thumbnailUrl ? new Date() : null,
            lastSyncedAt: new Date(),
            lastSyncError,
            integrationId,
          })
          return { id: link.id, ok: true as const }
        } catch (e) {
          const msg = (e as Error).message
          await taskFigmaLinkRepository.update(link.id, {
            lastSyncError: msg.slice(0, 200),
            lastSyncedAt: new Date(),
          })
          return { id: link.id, ok: false as const, error: msg }
        }
      })
    )
  },
}
