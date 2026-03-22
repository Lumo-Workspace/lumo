import { NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, getUserWorkspace } from '@/lib/auth'

/**
 * GET /api/workspaces/members
 * Returns all members of the current user's workspace,
 * enriched with Clerk display name and avatar.
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

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: ws.workspaceId },
      orderBy: { joinedAt: 'asc' },
    })

    // Batch-fetch Clerk user profiles
    const client = await clerkClient()
    const clerkUsers = await client.users.getUserList({
      userId: members.map(m => m.clerkId),
      limit: 100,
    })

    const userMap = new Map(clerkUsers.data.map(u => [u.id, u]))

    const shaped = members.map(m => {
      const u = userMap.get(m.clerkId)
      return {
        id: m.id, // WorkspaceMember.id — use as assigneeId
        clerkId: m.clerkId,
        role: m.role,
        name: u
          ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() ||
            u.emailAddresses[0]?.emailAddress
          : m.clerkId,
        email: u?.emailAddresses[0]?.emailAddress ?? null,
        imageUrl: u?.imageUrl ?? null,
      }
    })

    return NextResponse.json({ members: shaped })
  } catch (error) {
    console.error('GET /api/workspaces/members error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
