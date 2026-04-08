import { prisma } from '@/lib/db/prisma'

// ── Types ───────────────────────────────────────────────────────────────────

interface CreateDraftData {
  workspaceId: string
  creatorId: string
  type: string
  data: Record<string, unknown>
}

interface UpdateDraftData {
  type: string
  data: Record<string, unknown>
}

const DRAFT_SELECT = {
  id: true,
  type: true,
  data: true,
  createdAt: true,
  updatedAt: true,
} as const

// ── Draft Repository ────────────────────────────────────────────────────────

export const draftRepository = {
  /** Find all drafts for a given workspace + creator, newest first. */
  async findByWorkspaceAndCreator(workspaceId: string, creatorId: string) {
    return prisma.draft.findMany({
      where: { workspaceId, creatorId },
      orderBy: { updatedAt: 'desc' },
      select: DRAFT_SELECT,
    })
  },

  /** Find a single draft by ID. */
  async findById(id: string) {
    return prisma.draft.findUnique({ where: { id } })
  },

  /** Create a new draft. */
  async create(data: CreateDraftData) {
    return prisma.draft.create({
      data,
      select: DRAFT_SELECT,
    })
  },

  /** Update an existing draft. */
  async update(id: string, data: UpdateDraftData) {
    return prisma.draft.update({
      where: { id },
      data,
      select: DRAFT_SELECT,
    })
  },

  /** Delete a draft by ID. */
  async delete(id: string) {
    return prisma.draft.delete({ where: { id } })
  },
}
