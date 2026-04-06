import { NextRequest, NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { updateDocumentSchema } from '@/lib/validation/schemas'

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

async function getDocumentWithPermission(
  documentId: string,
  memberId: string,
  workspaceId: string
) {
  const doc = await prisma.document.findFirst({
    where: {
      id: documentId,
      workspaceId,
      OR: [
        { createdById: memberId },
        { visibility: 'WORKSPACE' },
        { shares: { some: { memberId } } },
      ],
    },
    include: {
      project: { select: { id: true, name: true } },
      createdBy: { select: { id: true, clerkId: true } },
      children: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          title: true,
          emoji: true,
          sortOrder: true,
          updatedAt: true,
        },
      },
      shares: {
        include: {
          member: { select: { id: true, clerkId: true } },
        },
      },
      _count: { select: { children: true } },
    },
  })
  return doc
}

function getUserRole(
  doc: { createdById: string; shares: { memberId: string; role: string }[] },
  memberId: string
): 'OWNER' | 'MANAGER' | 'EDITOR' | 'VIEWER' | null {
  if (doc.createdById === memberId) return 'OWNER'
  const share = doc.shares.find(s => s.memberId === memberId)
  if (share) return share.role as 'MANAGER' | 'EDITOR' | 'VIEWER'
  return null
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id } = await params
  const doc = await getDocumentWithPermission(id, ws.member.id, ws.workspaceId)
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  // Batch-fetch Clerk user profiles
  const allClerkIds = new Set<string>()
  allClerkIds.add(doc.createdBy.clerkId)
  for (const s of doc.shares) {
    allClerkIds.add(s.member.clerkId)
  }

  const client = await clerkClient()
  const clerkUsers = await client.users.getUserList({
    userId: [...allClerkIds],
    limit: 100,
  })
  const userMap = new Map(clerkUsers.data.map(u => [u.id, u]))

  const creatorUser = userMap.get(doc.createdBy.clerkId)
  const shaped = {
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

  return NextResponse.json({ document: shaped })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id } = await params
  const doc = await getDocumentWithPermission(id, ws.member.id, ws.workspaceId)
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const role = getUserRole(doc, ws.member.id)
  if (!role || role === 'VIEWER') {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  }

  const body = await request.json()
  const parsed = updateDocumentSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  // Only owner can change visibility
  if (parsed.data.visibility && role !== 'OWNER') {
    return NextResponse.json(
      { error: 'Only the owner can change visibility' },
      { status: 403 }
    )
  }

  const updateData: Record<string, unknown> = {}
  if (parsed.data.title !== undefined) updateData.title = parsed.data.title
  if (parsed.data.content !== undefined)
    updateData.content = parsed.data.content
  if (parsed.data.emoji !== undefined) updateData.emoji = parsed.data.emoji
  if (parsed.data.visibility !== undefined)
    updateData.visibility = parsed.data.visibility
  if (parsed.data.projectId !== undefined)
    updateData.projectId = parsed.data.projectId
  if (parsed.data.sortOrder !== undefined)
    updateData.sortOrder = parsed.data.sortOrder

  const updated = await prisma.$transaction(async tx => {
    const updatedDoc = await tx.document.update({
      where: { id },
      data: updateData,
    })

    // Sync DocumentMention if content was updated
    if (parsed.data.content) {
      await syncDocumentMentions(tx, id, parsed.data.content)
    }

    return updatedDoc
  })

  return NextResponse.json({ document: updated })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id } = await params
  const doc = await prisma.document.findFirst({
    where: { id, workspaceId: ws.workspaceId },
  })
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }
  if (doc.createdById !== ws.member.id) {
    return NextResponse.json(
      { error: 'Only the owner can delete a document' },
      { status: 403 }
    )
  }

  await prisma.$transaction(async tx => {
    // Re-parent children to null (become root-level)
    await tx.document.updateMany({
      where: { parentId: id },
      data: { parentId: null },
    })
    await tx.document.delete({ where: { id } })
  })

  return NextResponse.json({ success: true })
}

// ── Helper: sync @mentions in content ──────────────────────────────────

async function syncDocumentMentions(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  documentId: string,
  content: string
) {
  // Parse Tiptap JSON to extract task mention IDs
  const taskIds = extractTaskMentionIds(content)

  // Get current mentions
  const existing = await tx.documentMention.findMany({
    where: { documentId },
    select: { taskId: true },
  })
  const existingIds = new Set(existing.map(m => m.taskId))
  const newIds = new Set(taskIds)

  // Delete removed mentions
  const toDelete = [...existingIds].filter(id => !newIds.has(id))
  if (toDelete.length > 0) {
    await tx.documentMention.deleteMany({
      where: { documentId, taskId: { in: toDelete } },
    })
  }

  // Create new mentions
  const toCreate = [...newIds].filter(id => !existingIds.has(id))
  if (toCreate.length > 0) {
    await tx.documentMention.createMany({
      data: toCreate.map(taskId => ({ documentId, taskId })),
    })
  }
}

function extractTaskMentionIds(content: string): string[] {
  try {
    const json = JSON.parse(content)
    const ids: string[] = []
    function walk(node: Record<string, unknown>) {
      if (
        node.type === 'mention' &&
        (node.attrs as Record<string, unknown>)?.mentionType === 'task'
      ) {
        const id = (node.attrs as Record<string, unknown>)?.id
        if (typeof id === 'string') ids.push(id)
      }
      const nodeContent = node.content
      if (Array.isArray(nodeContent)) {
        nodeContent.forEach((child: Record<string, unknown>) => walk(child))
      }
    }
    walk(json)
    return [...new Set(ids)]
  } catch {
    return []
  }
}
