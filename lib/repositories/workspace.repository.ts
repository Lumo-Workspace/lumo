import { Prisma, type SummaryFrequency } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { generateIdentifier } from '@/lib/team'

// ── Types ───────────────────────────────────────────────────────────────────

export interface CreateWorkspaceData {
  name: string
  slug: string
  clerkId: string
}

export interface WorkspaceUpdateData {
  name?: string
  slug?: string
  logoUrl?: string | null
  summaryEnabled?: boolean
  summaryFrequency?: SummaryFrequency | string
  summaryLocale?: string
  /** LUM-740: the raw policy JSON; `null` resets to the default. */
  securityPolicy?: unknown
  /** LUM-859: raw hook-event retention in days; null = keep forever. */
  hookEventRetentionDays?: number | null
  /** LUM-911: days a used-up scan keeps its code; 0 = zero retention. */
  scanEvidenceRetentionDays?: number
  /** LUM-866: per-workspace security-scan switches. */
  securityScanEnabled?: boolean
  securityAiReviewEnabled?: boolean
  securityHuntEnabled?: boolean
}

// ── Workspace Repository ────────────────────────────────────────────────────

export const workspaceRepository = {
  /** LUM-911 — each workspace's scan evidence retention, in days. */
  async findScanEvidenceRetention(
    workspaceIds: string[]
  ): Promise<Map<string, number>> {
    if (workspaceIds.length === 0) return new Map()
    const rows = await prisma.workspace.findMany({
      where: { id: { in: workspaceIds } },
      select: { id: true, scanEvidenceRetentionDays: true },
    })
    return new Map(rows.map(row => [row.id, row.scanEvidenceRetentionDays]))
  },

  /** LUM-911 — workspaces that keep no scan evidence once a scan is final. */
  async findZeroScanEvidenceRetentionIds(): Promise<string[]> {
    const rows = await prisma.workspace.findMany({
      where: { scanEvidenceRetentionDays: 0 },
      select: { id: true },
    })
    return rows.map(row => row.id)
  },

  /** Create workspace with default team, owner member, human + agent actors in a transaction. */
  async create(data: CreateWorkspaceData) {
    return prisma.$transaction(async tx => {
      const workspace = await tx.workspace.create({
        data: { name: data.name, slug: data.slug },
      })

      const team = await tx.team.create({
        data: {
          workspaceId: workspace.id,
          name: data.name,
          identifier: generateIdentifier(data.name),
          isDefault: true,
        },
      })

      const member = await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          clerkId: data.clerkId,
          role: 'OWNER',
        },
      })

      // Add owner to the default team
      await tx.teamMember.create({
        data: { teamId: team.id, memberId: member.id },
      })

      // Create human actor for the owner
      await tx.actor.create({
        data: { workspaceId: workspace.id, type: 'HUMAN', memberId: member.id },
      })

      // Create Coding Agent profile + actor
      const agentProfile = await tx.agentProfile.create({
        data: {
          workspaceId: workspace.id,
          name: 'Coding Agent',
          type: 'CODING',
        },
      })
      await tx.actor.create({
        data: {
          workspaceId: workspace.id,
          type: 'AGENT',
          agentId: agentProfile.id,
        },
      })

      return { workspace, member }
    })
  },

  /** Find full workspace row by ID. */
  async findById(id: string) {
    return prisma.workspace.findUnique({ where: { id } })
  },

  /** LUM-740: the raw `securityPolicy` Json column (null when unset or the
   *  workspace is missing) — parse with `parseSecurityPolicy`. */
  async findSecurityPolicy(id: string): Promise<unknown> {
    const row = await prisma.workspace.findUnique({
      where: { id },
      select: { securityPolicy: true },
    })
    return row?.securityPolicy ?? null
  },

  /** LUM-866: the three security-scan switches; null when the workspace is
   *  missing — resolve with `resolveSecurityLayers`. */
  async findSecuritySwitches(id: string) {
    return prisma.workspace.findUnique({
      where: { id },
      select: {
        securityScanEnabled: true,
        securityAiReviewEnabled: true,
        securityHuntEnabled: true,
      },
    })
  },

  /** Find workspace name and slug by ID. */
  async findNameAndSlug(id: string) {
    return prisma.workspace.findUnique({
      where: { id },
      select: { name: true, slug: true },
    })
  },

  /** Update workspace fields. A `securityPolicy: null` clears the Json column to SQL NULL (LUM-740). */
  async update(id: string, data: WorkspaceUpdateData) {
    const { securityPolicy, ...rest } = data
    const payload: Record<string, unknown> = { ...rest }
    if (securityPolicy !== undefined) {
      payload.securityPolicy =
        securityPolicy === null
          ? Prisma.DbNull
          : (securityPolicy as Prisma.InputJsonValue)
    }
    return prisma.workspace.update({
      where: { id },
      data: payload as Parameters<typeof prisma.workspace.update>[0]['data'],
    })
  },

  /** Check if slug is unique, optionally excluding a specific workspace. */
  async isSlugUnique(slug: string, excludeId?: string) {
    const existing = await prisma.workspace.findFirst({
      where: {
        slug,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    })
    return !existing
  },
}
