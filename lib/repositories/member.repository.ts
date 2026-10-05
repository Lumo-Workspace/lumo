import { prisma } from '@/lib/db/prisma'
import type { WorkspaceRole } from '@prisma/client'

// ── Member Repository ──────────────────────────────────────────────────────

export const memberRepository = {
  /** Find all members of a workspace, ordered by join date, with actor IDs. */
  async findByWorkspace(workspaceId: string) {
    return prisma.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: { joinedAt: 'asc' },
      include: {
        actor: { select: { id: true } },
      },
    })
  },

  /** Find a member by composite unique key (workspace + clerkId). */
  async findByWorkspaceAndClerkId(workspaceId: string, clerkId: string) {
    return prisma.workspaceMember.findUnique({
      where: {
        workspaceId_clerkId: { workspaceId, clerkId },
      },
    })
  },

  /** The caller's membership id and role in one workspace, or null. */
  async findRoleInWorkspace(workspaceId: string, clerkId: string) {
    return prisma.workspaceMember.findUnique({
      where: { workspaceId_clerkId: { workspaceId, clerkId } },
      select: { id: true, workspaceId: true, role: true },
    })
  },

  /** Find a member by ID with workspace scoping fields. */
  async findById(memberId: string) {
    return prisma.workspaceMember.findUnique({
      where: { id: memberId },
      select: { id: true, workspaceId: true, role: true },
    })
  },

  /** The Clerk user id for a member, or null if the member is missing. */
  async findClerkIdById(memberId: string): Promise<string | null> {
    const row = await prisma.workspaceMember.findUnique({
      where: { id: memberId },
      select: { clerkId: true },
    })
    return row?.clerkId ?? null
  },

  /** Update a member's role. */
  async updateRole(memberId: string, role: WorkspaceRole) {
    return prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role },
      select: { id: true, role: true },
    })
  },

  /** Count owners in a workspace. */
  async countOwners(workspaceId: string) {
    return prisma.workspaceMember.count({
      where: { workspaceId, role: 'OWNER' },
    })
  },

  /** Find all workspace memberships for a given Clerk user across all workspaces. */
  async findByClerkId(clerkId: string) {
    return prisma.workspaceMember.findMany({
      where: { clerkId },
      select: {
        id: true,
        workspaceId: true,
        role: true,
        workspace: { select: { id: true, name: true, slug: true } },
      },
    })
  },

  /** Find the first member for a clerk user (any workspace). */
  async findFirstByClerkId(clerkId: string) {
    return prisma.workspaceMember.findFirst({
      where: { clerkId },
    })
  },

  /** Find the actor record for a given member. */
  async findActorByMemberId(memberId: string) {
    return prisma.actor.findUnique({
      where: { memberId },
    })
  },

  /**
   * Resolve a HUMAN actor id back to the workspace member that backs it.
   * Returns null if the actor doesn't exist or has no member (e.g. AGENT actors).
   */
  async findByActorId(actorId: string) {
    const actor = await prisma.actor.findUnique({
      where: { id: actorId },
      select: {
        workspaceId: true,
        member: { select: { id: true } },
      },
    })
    if (!actor?.member) return null
    return { id: actor.member.id, workspaceId: actor.workspaceId }
  },

  /** Delete a member by ID. */
  async delete(memberId: string) {
    return prisma.workspaceMember.delete({
      where: { id: memberId },
    })
  },

  /** Find agent actors for a workspace. */
  async findAgentActors(workspaceId: string) {
    return prisma.actor.findMany({
      where: { workspaceId, type: 'AGENT' },
      select: {
        id: true,
        agent: { select: { name: true, avatarColor: true, type: true } },
      },
    })
  },

  /** Find existing coding agent profile for a workspace (not linked to a member). */
  async findCodingAgentProfile(workspaceId: string) {
    return prisma.agentProfile.findFirst({
      where: { workspaceId, type: 'CODING', memberId: null },
    })
  },

  /** Find workspace members by clerkIds within a workspace. */
  async findByWorkspaceAndClerkIds(workspaceId: string, clerkIds: string[]) {
    return prisma.workspaceMember.findMany({
      where: { workspaceId, clerkId: { in: clerkIds } },
      select: { clerkId: true, actor: { select: { id: true } } },
    })
  },

  /**
   * Display labels for member ids — best-effort map for rollups (LUM-523).
   *
   * WorkspaceMember has no DB-local name/email (profiles live in Clerk), so we
   * resolve clerkId → display name via Clerk in one batch call. Falls back to
   * the email local-part, then the raw clerkId, then the member id, so every
   * requested id gets *some* label and callers never see an empty cell. Never
   * throws — Clerk failures degrade to the member-id label.
   */
  async labelsByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map()

    const members = await prisma.workspaceMember.findMany({
      where: { id: { in: ids } },
      select: { id: true, clerkId: true },
    })

    // Default every id to itself so unresolved ids still render.
    const labels = new Map<string, string>(members.map(m => [m.id, m.id]))

    const clerkIds = [...new Set(members.map(m => m.clerkId))]
    if (clerkIds.length === 0) return labels

    try {
      const { createClerkClient } = await import('@clerk/nextjs/server')
      const clerk = createClerkClient({
        secretKey: process.env.CLERK_SECRET_KEY!,
      })
      const { data: users } = await clerk.users.getUserList({
        userId: clerkIds,
        limit: Math.min(clerkIds.length, 500),
      })

      const labelByClerkId = new Map<string, string>()
      for (const u of users) {
        const email =
          u.emailAddresses.find(e => e.id === u.primaryEmailAddressId)
            ?.emailAddress ??
          u.emailAddresses[0]?.emailAddress ??
          ''
        const fullName = [u.firstName, u.lastName]
          .filter(Boolean)
          .join(' ')
          .trim()
        const display = fullName || email.split('@')[0] || email || u.id
        labelByClerkId.set(u.id, display)
      }

      for (const m of members) {
        const display = labelByClerkId.get(m.clerkId)
        if (display) labels.set(m.id, display)
      }
    } catch {
      // Clerk unavailable: keep the member-id fallback labels.
    }

    return labels
  },

  /** Create a coding agent profile + actor for a workspace. */
  async createCodingAgent(workspaceId: string) {
    const profile = await prisma.agentProfile.create({
      data: { workspaceId, name: 'Coding Agent', type: 'CODING' },
    })
    await prisma.actor.create({
      data: { workspaceId, type: 'AGENT', agentId: profile.id },
    })
    return profile
  },

  /**
   * Resolve a list of emails to Actor IDs within a workspace.
   * Flow: emails → Clerk user IDs → WorkspaceMember records → Actor IDs.
   * Preserves the input order of matched emails. Silently skips emails
   * with no Clerk user or no workspace membership.
   */
  async findActorsByEmailInWorkspace(
    workspaceId: string,
    emails: string[]
  ): Promise<string[]> {
    if (emails.length === 0) return []

    const { createClerkClient } = await import('@clerk/nextjs/server')
    const clerk = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY!,
    })

    const { data: users } = await clerk.users.getUserList({
      emailAddress: emails,
      limit: Math.min(emails.length * 2, 100),
    })

    // Map email → clerkId (preserve first match per email)
    const emailToClerkId = new Map<string, string>()
    for (const user of users) {
      for (const ea of user.emailAddresses) {
        if (
          emails.includes(ea.emailAddress) &&
          !emailToClerkId.has(ea.emailAddress)
        ) {
          emailToClerkId.set(ea.emailAddress, user.id)
        }
      }
    }

    const orderedClerkIds = emails
      .map(e => emailToClerkId.get(e))
      .filter((id): id is string => !!id)

    if (orderedClerkIds.length === 0) return []

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId, clerkId: { in: orderedClerkIds } },
      select: { clerkId: true, actor: { select: { id: true } } },
    })

    const clerkIdToActor = new Map<string, string>()
    for (const m of members) {
      if (m.actor?.id) clerkIdToActor.set(m.clerkId, m.actor.id)
    }

    return orderedClerkIds
      .map(id => clerkIdToActor.get(id))
      .filter((a): a is string => !!a)
  },

  /**
   * Return every workspace member with Clerk email + display name + actor id
   * in a single batch call. Used by CLI assignee resolution where we may
   * need to match by either email or name in one request, and where the
   * caller can tolerate Clerk's ~100-300ms roundtrip.
   *
   * Members with no actor row are omitted (you can't assign to them anyway).
   * Members whose Clerk profile is missing get empty email/displayName so
   * the caller's "no match" message can still list them as candidates.
   */
  async findAllWithProfilesForCli(workspaceId: string): Promise<
    {
      memberId: string
      clerkId: string
      actorId: string
      email: string
      displayName: string
    }[]
  > {
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      select: {
        id: true,
        clerkId: true,
        actor: { select: { id: true } },
      },
      orderBy: { joinedAt: 'asc' },
    })

    const eligible = members.filter(
      (m): m is typeof m & { actor: { id: string } } => m.actor !== null
    )
    if (eligible.length === 0) return []

    const clerkIds = eligible.map(m => m.clerkId)

    const { createClerkClient } = await import('@clerk/nextjs/server')
    const clerk = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY!,
    })
    // Clerk's `getUserList` accepts up to 500 per page. We're filtering by
    // `userId` (exact-match list), so this `limit` is just a page-size cap,
    // not a search-scope filter. Workspaces over 500 members would need
    // pagination — out of scope for v1.
    const { data: users } = await clerk.users.getUserList({
      userId: clerkIds,
      limit: Math.min(clerkIds.length, 500),
    })

    const profileByClerkId = new Map<
      string,
      { email: string; displayName: string }
    >()
    for (const u of users) {
      const email =
        u.emailAddresses.find(e => e.id === u.primaryEmailAddressId)
          ?.emailAddress ??
        u.emailAddresses[0]?.emailAddress ??
        ''
      const fullName = [u.firstName, u.lastName]
        .filter(Boolean)
        .join(' ')
        .trim()
      const displayName = fullName || email.split('@')[0] || ''
      profileByClerkId.set(u.id, { email, displayName })
    }

    return eligible.map(m => {
      const p = profileByClerkId.get(m.clerkId)
      return {
        memberId: m.id,
        clerkId: m.clerkId,
        actorId: m.actor.id,
        email: p?.email ?? '',
        displayName: p?.displayName ?? '',
      }
    })
  },
}
