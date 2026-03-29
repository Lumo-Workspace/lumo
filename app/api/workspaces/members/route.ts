import { NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { getOrCreateHumanActor } from '@/lib/actor'

/**
 * GET /api/workspaces/members
 * Returns all members of the current user's workspace,
 * enriched with Clerk display name and avatar.
 * Also returns agentActors for the workspace.
 */
export async function GET() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await getUserWorkspace(userId)
    if (!ws) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    const workspaceId = ws.workspaceId

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: { joinedAt: 'asc' },
      include: {
        actor: { select: { id: true } },
      },
    })

    // Batch-fetch Clerk user profiles
    const client = await clerkClient()
    const clerkUsers = await client.users.getUserList({
      userId: members.map(m => m.clerkId),
      limit: 100,
    })

    const userMap = new Map(clerkUsers.data.map(u => [u.id, u]))

    // Lazy-create actors for members that don't have one yet (pre-migration data)
    for (const m of members) {
      if (!m.actor) {
        const actorId = await getOrCreateHumanActor(workspaceId, m.id)
        m.actor = { id: actorId }
      }
    }

    const enrichedMembers = members.map(m => {
      const u = userMap.get(m.clerkId)
      return {
        id: m.id, // WorkspaceMember.id
        clerkId: m.clerkId,
        role: m.role,
        name: u
          ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() ||
            u.emailAddresses[0]?.emailAddress
          : m.clerkId,
        email: u?.emailAddresses[0]?.emailAddress ?? null,
        imageUrl: u?.imageUrl ?? null,
        joinedAt: m.joinedAt.toISOString(),
        actorId: m.actor?.id ?? null,
      }
    })

    // Lazy-create Coding Agent if not yet seeded for this workspace
    const existingAgent = await prisma.agentProfile.findUnique({
      where: { workspaceId_type: { workspaceId, type: 'CODING' } },
    })
    if (!existingAgent) {
      const profile = await prisma.agentProfile.create({
        data: { workspaceId, name: 'Coding Agent', type: 'CODING' },
      })
      await prisma.actor.create({
        data: { workspaceId, type: 'AGENT', agentId: profile.id },
      })
    }

    const agentActors = await prisma.actor.findMany({
      where: { workspaceId, type: 'AGENT' },
      select: {
        id: true,
        agent: { select: { name: true, avatarColor: true, type: true } },
      },
    })

    return NextResponse.json({
      members: enrichedMembers,
      agentActors: agentActors.map(a => ({
        actorId: a.id,
        name: a.agent?.name ?? 'Agent',
        avatarColor: a.agent?.avatarColor ?? '#6366f1',
        type: a.agent?.type ?? 'CODING',
      })),
    })
  } catch (error) {
    console.error('GET /api/workspaces/members error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
