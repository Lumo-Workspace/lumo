import { prisma } from '@/lib/db/prisma'
import { ACTIVE_MEMBER } from '@/lib/members/deactivation'
import type { TaskPriority } from '@prisma/client'

// ── Types ───────────────────────────────────────────────────────────────────

interface CreateWaitlistEntryData {
  email: string
  name: string | null
  company: string | null
  teamSize: string | null
}

interface CreateApiKeyData {
  workspaceMemberId: string
  label: string
  keyHash: string
  keyPrefix: string
  scope?: string | null
}

interface CreatePriorityOverrideData {
  taskId: string
  memberId: string
  projectId: string
  aiSuggested: TaskPriority
  userChosen: TaskPriority
  taskTitle: string
  taskDescription: string | null
}

// ── Misc Repository ────────────────────────────────────────────────────────

export const miscRepository = {
  // ── WaitlistEntry ──────────────────────────────────────────────────────

  /** Find a waitlist entry by email. */
  async findWaitlistEntryByEmail(email: string) {
    return prisma.waitlistEntry.findUnique({ where: { email } })
  },

  /** Create a waitlist entry. */
  async createWaitlistEntry(data: CreateWaitlistEntryData) {
    return prisma.waitlistEntry.create({ data })
  },

  /** An APPROVED waitlist entry for any of these (lowercase) emails. */
  async findApprovedWaitlistEntryByEmails(emails: string[]) {
    if (emails.length === 0) return null
    return prisma.waitlistEntry.findFirst({
      where: { email: { in: emails }, status: 'APPROVED' },
      select: { id: true },
    })
  },

  /**
   * Record a blocked workspace-creation attempt. Creates a PENDING
   * ONBOARDING_BLOCKED entry; an existing row for the email is left untouched.
   */
  async upsertBlockedWaitlistEntry(data: {
    email: string
    name: string | null
  }) {
    return prisma.waitlistEntry.upsert({
      where: { email: data.email },
      create: {
        email: data.email,
        name: data.name,
        source: 'ONBOARDING_BLOCKED',
      },
      update: {},
      select: { id: true, status: true },
    })
  },

  // ── ApiKey ─────────────────────────────────────────────────────────────

  /** List active (non-revoked) API keys for a workspace member. */
  async findActiveApiKeys(workspaceMemberId: string) {
    return prisma.apiKey.findMany({
      where: { workspaceMemberId, revokedAt: null },
      select: {
        id: true,
        label: true,
        keyPrefix: true,
        createdAt: true,
        lastUsedAt: true,
        scope: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  },

  /** Find an API key by ID (for ownership check). */
  async findApiKeyById(id: string) {
    return prisma.apiKey.findUnique({
      where: { id },
      select: { workspaceMemberId: true, revokedAt: true },
    })
  },

  /**
   * Find an API key by hash with the owning member's clerkId and workspace.
   * Used by the CLI bearer-token verify endpoint.
   */
  async findApiKeyByHashForVerify(keyHash: string) {
    return prisma.apiKey.findUnique({
      where: { keyHash },
      select: {
        id: true,
        label: true,
        keyPrefix: true,
        revokedAt: true,
        scope: true,
        member: {
          select: {
            id: true,
            clerkId: true,
            deactivatedAt: true,
            workspace: {
              select: { id: true, slug: true, name: true },
            },
          },
        },
      },
    })
  },

  /** Fire-and-forget touch of lastUsedAt. */
  async touchApiKeyLastUsed(keyHash: string) {
    return prisma.apiKey.update({
      where: { keyHash },
      data: { lastUsedAt: new Date() },
    })
  },

  /** Create a new API key. */
  async createApiKey(data: CreateApiKeyData) {
    return prisma.apiKey.create({
      data,
      select: {
        id: true,
        label: true,
        keyPrefix: true,
        createdAt: true,
        scope: true,
      },
    })
  },

  /** Revoke (soft-delete) an API key. */
  async revokeApiKey(id: string) {
    return prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    })
  },

  // ── UserPreference ─────────────────────────────────────────────────────

  /** Find user preferences by member ID. */
  async findUserPreference(memberId: string) {
    return prisma.userPreference.findUnique({ where: { memberId } })
  },

  /** Upsert user preferences. */
  async upsertUserPreference(
    memberId: string,
    update: Record<string, unknown>
  ) {
    return prisma.userPreference.upsert({
      where: { memberId },
      update,
      create: { memberId, ...update },
    })
  },

  // ── PriorityOverride ──────────────────────────────────────────────────

  /** Record a priority override. */
  async createPriorityOverride(data: CreatePriorityOverrideData) {
    return prisma.priorityOverride.create({ data })
  },

  /** Find priority overrides for a member in a project. */
  async findPriorityOverrides(
    memberId: string,
    projectId: string,
    take: number
  ) {
    return prisma.priorityOverride.findMany({
      where: { memberId, projectId },
      select: { taskTitle: true, aiSuggested: true, userChosen: true },
      orderBy: { createdAt: 'desc' },
      take,
    })
  },

  // ── HookEvent helper ───────────────────────────────────────────────────

  /** Resolve an ACTIVE workspaceMember.id from clerkId + workspaceId (hook ingestion, bearer identity). */
  async findMemberIdForHook(clerkId: string, workspaceId: string) {
    const row = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_clerkId: { workspaceId, clerkId },
        ...ACTIVE_MEMBER,
      },
      select: { id: true },
    })
    return row?.id ?? null
  },

  /** Resolve the role of a WorkspaceMember by its primary-key id. */
  async findMemberRoleById(memberId: string) {
    const row = await prisma.workspaceMember.findUnique({
      where: { id: memberId },
      select: { role: true },
    })
    return row?.role ?? null
  },

  // ── DocumentMention ───────────────────────────────────────────────────

  /** Find document mentions for a task, filtered by workspace access. */
  async findDocumentMentionsByTask(
    taskId: string,
    workspaceId: string,
    memberId: string
  ) {
    return prisma.documentMention.findMany({
      where: {
        taskId,
        document: {
          workspaceId,
          deletedAt: null, // LUM-918: skip trashed documents
          OR: [
            { createdById: memberId },
            { visibility: 'WORKSPACE' },
            { shares: { some: { memberId } } },
          ],
        },
      },
      include: {
        document: {
          select: {
            id: true,
            slug: true,
            title: true,
            emoji: true,
            updatedAt: true,
            parentId: true,
            sortOrder: true,
            visibility: true,
            project: { select: { id: true, name: true } },
          },
        },
      },
    })
  },

  /**
   * Documents mentioned by a task, shaped for the context-tiering renderer
   * (LUM-122). Kept separate from `findDocumentMentionsByTask` so the
   * documents-list API isn't burdened with the (potentially large) `content`
   * body: here we additionally pull `summary` + `summaryGeneratedAt` (the
   * inline card + staleness check) and `content` (converted to markdown when
   * scheduling the load-time lazy summary refresh).
   *
   * Same workspace + visibility access filter as `findDocumentMentionsByTask`.
   */
  async findDocumentsForContext(
    taskId: string,
    workspaceId: string,
    memberId: string
  ) {
    const mentions = await prisma.documentMention.findMany({
      where: {
        taskId,
        document: {
          workspaceId,
          deletedAt: null, // LUM-918: skip trashed documents
          OR: [
            { createdById: memberId },
            { visibility: 'WORKSPACE' },
            { shares: { some: { memberId } } },
          ],
        },
      },
      include: {
        document: {
          select: {
            id: true,
            slug: true,
            title: true,
            updatedAt: true,
            summary: true,
            summaryGeneratedAt: true,
            content: true,
          },
        },
      },
    })
    return mentions.map(m => m.document)
  },
}
