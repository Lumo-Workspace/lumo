import { prisma } from '@/lib/db/prisma'

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

  /** Find a member by ID with workspace scoping fields. */
  async findById(memberId: string) {
    return prisma.workspaceMember.findUnique({
      where: { id: memberId },
      select: { id: true, workspaceId: true, role: true },
    })
  },

  /** Update a member's role. */
  async updateRole(memberId: string, role: string) {
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
}
