import { NextRequest, NextResponse } from 'next/server'
import { listUsersByIds } from '@/lib/auth/user-batch'
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
    const clerkUsers = await listUsersByIds(
      users,
      members.map(m => m.clerkId)
    )

    const userMap = new Map(clerkUsers.map(u => [u.id, u]))

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
