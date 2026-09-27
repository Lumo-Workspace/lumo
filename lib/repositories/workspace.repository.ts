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
  verificationMaxRounds?: number
  acceptanceMode?: boolean
  /** LUM-740: the raw policy JSON; `null` resets to the default. */
  securityPolicy?: unknown
}

// ── Workspace Repository ────────────────────────────────────────────────────

export const workspaceRepository = {
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

  /** Read just the machine-verification round cap (LUM-429). Null when the
   *  workspace is missing so callers can fall back to the default. */
  async findVerificationMaxRounds(id: string) {
    const row = await prisma.workspace.findUnique({
      where: { id },
      select: { verificationMaxRounds: true },
    })
    return row?.verificationMaxRounds ?? null
  },

  /** Read the acceptance-mode toggle for the workspace owning a task (LUM-431).
   *  Joins task → project → workspace so the nudge gate can resolve the flag
   *  from a taskId alone. Null when the task/workspace is missing so callers
   *  can fall back to the default-off behavior. */
  async findAcceptanceModeByTask(taskId: string) {
    const row = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        project: {
          select: { workspace: { select: { acceptanceMode: true } } },
        },
      },
    })
    return row?.project?.workspace?.acceptanceMode ?? null
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
