import { NextRequest, NextResponse } from 'next/server'
import { getUserDirectory } from '@/lib/auth/users'
import { requireIdentity } from '@/lib/auth'
import { getOrCreateHumanActor } from '@/lib/actor'
import { memberService } from '@/lib/services/member.service'

/**
 * GET /api/workspaces/members
 * Returns all members of the current user's workspace,
 * enriched with Clerk display name and avatar.
 * Also returns agentActors for the workspace.
 */
export async function GET(request: NextRequest) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const workspaceId = identity.workspaceId

    const members = await memberService.listMembers(workspaceId)

    // Batch-fetch Clerk user profiles
    const users = await getUserDirectory()
    const clerkUsers = await users.getUserList({
      userId: members.map(m => m.clerkId),
      // Clerk caps getUserList at 500; the old fixed 100 silently dropped
      // members past the first page in larger workspaces.
      limit: Math.min(500, Math.max(1, members.length)),
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
      const email =
        u?.emailAddresses.find(e => e.id === u.primaryEmailAddressId)
          ?.emailAddress ??
        u?.emailAddresses[0]?.emailAddress ??
        null
      return {
        id: m.id, // WorkspaceMember.id
        clerkId: m.clerkId,
        role: m.role,
        name: u
          ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || email
          : m.clerkId,
        email,
        imageUrl: u?.imageUrl ?? null,
        joinedAt: m.joinedAt.toISOString(),
        actorId: m.actor?.id ?? null,
      }
    })

    const agentActors = await memberService.getAgentActors(workspaceId)

    return NextResponse.json({
      members: enrichedMembers,
      agentActors,
    })
  } catch (error) {
    console.error('GET /api/workspaces/members error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
