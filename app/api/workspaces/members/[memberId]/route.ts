import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { updateMemberRoleSchema } from '@/lib/validation/schemas'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await getUserWorkspace(userId)
    if (!ws) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    // Caller must be OWNER
    if (ws.member.role !== 'OWNER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { memberId } = await params

    // Prevent editing own role
    if (memberId === ws.member.id) {
      return NextResponse.json(
        { error: 'You cannot change your own role' },
        { status: 400 }
      )
    }

    // Validate target belongs to same workspace
    const target = await prisma.workspaceMember.findUnique({
      where: { id: memberId },
      select: { id: true, workspaceId: true, role: true },
    })

    if (!target || target.workspaceId !== ws.workspaceId) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = updateMemberRoleSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      )
    }

    const { role } = parsed.data

    // Guard: cannot demote the last OWNER
    if (target.role === 'OWNER' && role === 'MEMBER') {
      const ownerCount = await prisma.workspaceMember.count({
        where: { workspaceId: ws.workspaceId, role: 'OWNER' },
      })
      if (ownerCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot remove the last admin' },
          { status: 400 }
        )
      }
    }

    const updated = await prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role },
      select: { id: true, role: true },
    })

    return NextResponse.json({ member: updated })
  } catch (error) {
    console.error('PATCH /api/workspaces/members/[memberId] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
