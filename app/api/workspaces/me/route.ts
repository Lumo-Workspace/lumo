import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { createWorkspaceSchema } from '@/lib/validation/schemas'

/**
 * GET /api/workspaces/me — Get the current user's workspace.
 */
export async function GET() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const result = await requireUserWorkspace(userId)
    if (result instanceof NextResponse) return result

    return NextResponse.json({
      workspace: result.workspace,
      role: result.member.role,
    })
  } catch (error) {
    console.error('GET /api/workspaces/me error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/workspaces/me — Update workspace name and/or slug.
 * Caller must be an OWNER.
 */
export async function PATCH(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws
    if (ws.member.role !== 'OWNER') {
      return NextResponse.json(
        { error: 'Only admins can update workspace settings' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const parsed = createWorkspaceSchema.partial().safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const { name, slug } = parsed.data

    // Check slug uniqueness if changing
    if (slug && slug !== ws.workspace.slug) {
      const existing = await prisma.workspace.findFirst({
        where: { slug, id: { not: ws.workspaceId } },
      })
      if (existing) {
        return NextResponse.json(
          { error: 'This URL is already taken' },
          { status: 409 }
        )
      }
    }

    const updated = await prisma.workspace.update({
      where: { id: ws.workspaceId },
      data: { ...(name && { name }), ...(slug && { slug }) },
    })

    return NextResponse.json({ workspace: updated })
  } catch (error) {
    console.error('PATCH /api/workspaces/me error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/workspaces/me — Permanently delete the workspace.
 * Caller must be an OWNER. All data is cascade-deleted.
 */
export async function DELETE() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws
    if (ws.member.role !== 'OWNER') {
      return NextResponse.json(
        { error: 'Only admins can delete a workspace' },
        { status: 403 }
      )
    }

    await prisma.workspace.delete({ where: { id: ws.workspaceId } })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/workspaces/me error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
