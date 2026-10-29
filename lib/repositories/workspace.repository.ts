import type {
  HookEventRetentionMode,
  Prisma,
  SummaryFrequency,
} from '@prisma/client'
import type { AiFeatureSwitches } from '@/lib/ai-features/registry'
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
  /** LUM-1097: default language (Slack, DM fallback, LUM-1117 AI summaries). */
  defaultLocale?: string
  /** LUM-859: raw hook-event retention in days; null = keep forever. */
  hookEventRetentionDays?: number | null
  /** LUM-933: session record mode (RETAIN | USED_UP). */
  hookEventRetentionMode?: HookEventRetentionMode
  /** LUM-933: cutoff — events before it follow the legacy tier. */
  hookEventRetentionSince?: Date | null
  hookEventRetentionLegacyDays?: number | null
  /** LUM-933: crossings ruled before it are never purged automatically. */
  crossingRawRetentionSince?: Date
  /** LUM-912: days a dispositioned crossing keeps its raw text. */
  crossingRawRetentionDays?: number
  /** LUM-941: days a dead letter keeps its webhook payload. */
  deadLetterRetentionDays?: number
  /** LUM-917: generate AI-derived content (memories, summaries). */
  aiDerivedContentEnabled?: boolean
  /** LUM-1334: the DONE requirement switches. */
  doneRequiresTestCase?: boolean
  doneRequiresReview?: boolean
  /** LUM-1338: the AI feature switches (sparse; absent = on). */
  aiFeatureSwitches?: AiFeatureSwitches
}

// ── Workspace Repository ────────────────────────────────────────────────────

export const workspaceRepository = {
  /** LUM-933 — the stored retention settings a change is computed from. */
  /**
   * LUM-907: the audited setting columns, read before a settings change.
   * The caller names them (LUM-1065: core + installed plugins' columns).
   */
  async findAuditedSettings(
    workspaceId: string,
    columns: readonly string[]
  ): Promise<Record<string, unknown> | null> {
    const select = Object.fromEntries(columns.map(f => [f, true]))
    return prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: select as Prisma.WorkspaceSelect,
    })
  },

  async findRetentionSettings(workspaceId: string): Promise<{
    hookEventRetentionMode: HookEventRetentionMode
    hookEventRetentionDays: number | null
    hookEventRetentionSince: Date | null
    hookEventRetentionLegacyDays: number | null
    crossingRawRetentionDays: number
    crossingRawRetentionSince: Date
  } | null> {
    return prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        hookEventRetentionMode: true,
        hookEventRetentionDays: true,
        hookEventRetentionSince: true,
        hookEventRetentionLegacyDays: true,
        crossingRawRetentionDays: true,
        crossingRawRetentionSince: true,
      },
    })
  },

  /** LUM-933 — the workspace's session record mode; null when the workspace is gone. */
  async findHookEventRetentionMode(
    workspaceId: string
  ): Promise<HookEventRetentionMode | null> {
    const row = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { hookEventRetentionMode: true },
    })
    return row?.hookEventRetentionMode ?? null
  },

  /**
   * LUM-943 — what the CLI tells members about session records: the current
   * mode and day tier, plus the slug for the settings link. Null when the
   * workspace is gone.
   */
  async findSessionRecordSetting(workspaceId: string): Promise<{
    slug: string
    hookEventRetentionMode: HookEventRetentionMode
    hookEventRetentionDays: number | null
  } | null> {
    return prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        slug: true,
        hookEventRetentionMode: true,
        hookEventRetentionDays: true,
      },
    })
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

  /** LUM-914 — slug per workspace id (operator reports print slugs, never names). */
  async findSlugs(workspaceIds: string[]): Promise<Map<string, string>> {
    if (workspaceIds.length === 0) return new Map()
    const rows = await prisma.workspace.findMany({
      where: { id: { in: workspaceIds } },
      select: { id: true, slug: true },
    })
    return new Map(rows.map(row => [row.id, row.slug]))
  },

  /** LUM-1097 — the workspace's default language; null when the workspace is gone. */
  async findDefaultLocale(workspaceId: string): Promise<string | null> {
    const row = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { defaultLocale: true },
    })
    return row?.defaultLocale ?? null
  },

  /** LUM-1334 — the DONE requirement switches; null when the workspace is gone. */
  async findDoneRequirements(
    workspaceId: string
  ): Promise<{ testCase: boolean; review: boolean } | null> {
    const row = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { doneRequiresTestCase: true, doneRequiresReview: true },
    })
    return row
      ? { testCase: row.doneRequiresTestCase, review: row.doneRequiresReview }
      : null
  },

  /** Find workspace name and slug by ID. */
  async findNameAndSlug(id: string) {
    return prisma.workspace.findUnique({
      where: { id },
      select: { name: true, slug: true },
    })
  },

  /**
   * Update workspace fields. Besides the core fields, `data` may carry the
   * columns an installed plugin owns (LUM-1062 `workspaceSettings`), already
   * mapped to Prisma write values by `toWorkspaceColumnWrites` (LUM-1065).
   */
  async update(id: string, data: WorkspaceUpdateData) {
    return prisma.workspace.update({
      where: { id },
      data: data as Parameters<typeof prisma.workspace.update>[0]['data'],
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
