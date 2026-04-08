import { Prisma } from '@prisma/client'
import { draftRepository } from '@/lib/repositories/draft.repository'

// ── Types ───────────────────────────────────────────────────────────────────

interface UpsertDraftInput {
  id?: string | undefined
  workspaceId: string
  creatorId: string
  type: string
  data: Prisma.InputJsonValue
}

// ── Draft Service ───────────────────────────────────────────────────────────

export const draftService = {
  /** List all drafts for a workspace + creator. */
  async listDrafts(workspaceId: string, creatorId: string) {
    return draftRepository.findByWorkspaceAndCreator(workspaceId, creatorId)
  },

  /** Create or update a draft. Verifies ownership on update. */
  async upsertDraft(input: UpsertDraftInput) {
    const { id, workspaceId, creatorId, type, data } = input

    if (id) {
      const existing = await draftRepository.findById(id)
      if (!existing || existing.creatorId !== creatorId) {
        throw Object.assign(new Error('Draft not found'), { status: 404 })
      }
      return draftRepository.update(id, { type, data })
    }

    return draftRepository.create({ workspaceId, creatorId, type, data })
  },

  /** Delete a draft. Verifies ownership before deletion. */
  async deleteDraft(id: string, creatorId: string) {
    const existing = await draftRepository.findById(id)
    if (!existing || existing.creatorId !== creatorId) {
      throw Object.assign(new Error('Draft not found'), { status: 404 })
    }
    return draftRepository.delete(id)
  },
}
