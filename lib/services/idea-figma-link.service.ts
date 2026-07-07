import { ideaFigmaLinkRepository } from '@/lib/repositories/idea-figma-link.repository'
import { resolveIdeaRef } from '@/lib/services/idea-evidence-resolve'
import { parseFigmaUrl } from '@/lib/integrations/figma/parse-url'
import {
  buildFigmaClient,
  pickRepresentativeFrame,
} from '@/lib/integrations/figma/build-client'
import type { IdeaFigmaLink } from '@prisma/client'

const FRESHNESS_MS = 7 * 24 * 3600 * 1000

function err(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, code })
}

export const ideaFigmaLinkService = {
  async addFigmaLink(input: {
    ideaRef: string
    workspaceId: string
    actorMemberId: string
    url: string
  }): Promise<IdeaFigmaLink> {
    const parsed = parseFigmaUrl(input.url)
    if (!parsed) throw err('Not a Figma URL', 422)

    const { ideaId, workspaceId } = await resolveIdeaRef({
      workspaceId: input.workspaceId,
      ideaRef: input.ideaRef,
    })

    const fileKey = parsed.fileKey
    const nodeIdStored = parsed.nodeId ?? ''

    const existing = await ideaFigmaLinkRepository.findByIdeaAndKey(
      ideaId,
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
      workspaceId,
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
      return ideaFigmaLinkRepository.update(existing.id, {
        fileName: file.name,
        frameName,
        thumbnailUrl,
        thumbnailFetchedAt: thumbnailUrl ? new Date() : null,
        lastSyncedAt: new Date(),
        lastSyncError,
        integrationId,
      })
    }

    return ideaFigmaLinkRepository.create({
      ideaId,
      workspaceId,
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

  async listForIdea(ideaId: string): Promise<IdeaFigmaLink[]> {
    return ideaFigmaLinkRepository.listByIdea(ideaId)
  },

  async removeFigmaLink(input: {
    input: string
    ideaId: string
  }): Promise<void> {
    if (input.input.startsWith('cfl_')) {
      const row = await ideaFigmaLinkRepository.findById(input.input)
      if (!row || row.ideaId !== input.ideaId) return
      await ideaFigmaLinkRepository.delete(row.id)
      return
    }
    const parsed = parseFigmaUrl(input.input)
    if (!parsed) return
    const row = await ideaFigmaLinkRepository.findByIdeaAndKey(
      input.ideaId,
      parsed.fileKey,
      parsed.nodeId ?? ''
    )
    if (!row) return
    await ideaFigmaLinkRepository.delete(row.id)
  },

  async refreshLinksForIdea(input: {
    ideaId: string
    workspaceId: string
    actorMemberId: string
  }): Promise<Array<{ id: string; ok: boolean; error?: string }>> {
    const links = await ideaFigmaLinkRepository.listByIdea(input.ideaId)
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
          await ideaFigmaLinkRepository.update(link.id, {
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
          await ideaFigmaLinkRepository.update(link.id, {
            lastSyncError: msg.slice(0, 200),
            lastSyncedAt: new Date(),
          })
          return { id: link.id, ok: false as const, error: msg }
        }
      })
    )
  },
}
