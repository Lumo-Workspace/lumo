import { NextRequest, NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { createDocumentSchema } from '@/lib/validation/schemas'

function resolveClerkName(
  u:
    | {
        firstName: string | null
        lastName: string | null
        emailAddresses: { emailAddress: string }[]
      }
    | undefined,
  fallback: string
): string {
  if (!u) return fallback
  return (
    `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() ||
    u.emailAddresses[0]?.emailAddress ||
    fallback
  )
}

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

  // Batch-fetch Clerk user profiles for all members referenced
  const allClerkIds = new Set<string>()
  for (const doc of documents) {
    allClerkIds.add(doc.createdBy.clerkId)
    for (const s of doc.shares) {
      allClerkIds.add(s.member.clerkId)
    }
  }

  const client = await clerkClient()
  const clerkUsers =
    allClerkIds.size > 0
      ? await client.users.getUserList({
          userId: [...allClerkIds],
          limit: 100,
        })
      : { data: [] }
  const userMap = new Map(clerkUsers.data.map(u => [u.id, u]))

  const shaped = documents.map(doc => {
    const creatorUser = userMap.get(doc.createdBy.clerkId)
    return {
      ...doc,
      createdBy: {
        id: doc.createdBy.id,
        name: resolveClerkName(creatorUser, doc.createdBy.clerkId),
        imageUrl: creatorUser?.imageUrl ?? null,
      },
      shares: doc.shares.map(s => {
        const shareUser = userMap.get(s.member.clerkId)
        return {
          ...s,
          member: {
            id: s.member.id,
            name: resolveClerkName(shareUser, s.member.clerkId),
            imageUrl: shareUser?.imageUrl ?? null,
          },
        }
      }),
    }
  })

  return NextResponse.json({ documents: shaped })
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

  // Calculate sortOrder: place new doc at the end of its siblings
  const parentId = parsed.data.parentId ?? null
  const maxSibling = await prisma.document.findFirst({
    where: { parentId, workspaceId: ws.workspaceId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })
  const sortOrder = (maxSibling?.sortOrder ?? 0) + 1

  const document = await prisma.document.create({
    data: {
      title: parsed.data.title,
      emoji: parsed.data.emoji ?? null,
      parentId,
      projectId: parsed.data.projectId ?? null,
      workspaceId: ws.workspaceId,
      createdById: ws.member.id,
      visibility: parsed.data.visibility,
      sortOrder,
    },
    include: {
      project: { select: { id: true, name: true } },
      createdBy: { select: { id: true, clerkId: true } },
      _count: { select: { children: true } },
    },
  })

  // Resolve creator name
  const client = await clerkClient()
  const clerkUsers = await client.users.getUserList({
    userId: [document.createdBy.clerkId],
    limit: 1,
  })
  const creatorUser = clerkUsers.data[0]

  const shaped = {
    ...document,
    createdBy: {
      id: document.createdBy.id,
      name: resolveClerkName(creatorUser, document.createdBy.clerkId),
      imageUrl: creatorUser?.imageUrl ?? null,
    },
  }

  return NextResponse.json({ document: shaped }, { status: 201 })
}
