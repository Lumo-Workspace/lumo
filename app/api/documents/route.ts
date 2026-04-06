import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { createDocumentSchema } from '@/lib/validation/schemas'

export async function GET(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { searchParams } = request.nextUrl
  const visibility = searchParams.get('visibility')
  const projectId = searchParams.get('projectId')
  const parentId = searchParams.get('parentId')
  const search = searchParams.get('search')

  const memberId = ws.member.id

  // Base permission filter: user can see documents they own, shared with them, or workspace-wide
  const permissionFilter = {
    workspaceId: ws.workspaceId,
    OR: [
      { createdById: memberId },
      { visibility: 'WORKSPACE' as const },
      { shares: { some: { memberId } } },
    ],
  }

  // Additional filters
  const where: Record<string, unknown> = { ...permissionFilter }

  if (visibility === 'PRIVATE') {
    where.createdById = memberId
    where.visibility = 'PRIVATE'
    delete (where as Record<string, unknown>).OR
  } else if (visibility === 'SHARED') {
    where.visibility = 'SHARED'
  } else if (visibility === 'WORKSPACE') {
    where.visibility = 'WORKSPACE'
  }

  if (projectId) where.projectId = projectId
  if (parentId) where.parentId = parentId
  if (parentId === null || searchParams.get('rootOnly') === 'true') {
    where.parentId = null
  }
  if (search) where.title = { contains: search, mode: 'insensitive' }

  const documents = await prisma.document.findMany({
    where,
    include: {
      project: { select: { id: true, name: true } },
      createdBy: { select: { id: true, clerkId: true } },
      shares: {
        include: {
          member: { select: { id: true, clerkId: true } },
        },
      },
      _count: { select: { children: true } },
    },
    orderBy: [{ updatedAt: 'desc' }],
  })

  return NextResponse.json({ documents })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const body = await request.json()
  const parsed = createDocumentSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  const document = await prisma.document.create({
    data: {
      title: parsed.data.title,
      emoji: parsed.data.emoji ?? null,
      parentId: parsed.data.parentId ?? null,
      projectId: parsed.data.projectId ?? null,
      workspaceId: ws.workspaceId,
      createdById: ws.member.id,
      visibility: parsed.data.visibility,
    },
    include: {
      project: { select: { id: true, name: true } },
      createdBy: { select: { id: true, clerkId: true } },
      _count: { select: { children: true } },
    },
  })

  return NextResponse.json({ document }, { status: 201 })
}
