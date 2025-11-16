import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import crypto from 'node:crypto'
import { validateTipTapContent } from '@/utils/validation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/config'

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug.slice(0, 50)
}

// Build a path using a random UUID to avoid collisions and decouple from title
function buildUuidPath() {
  const uuid = crypto.randomUUID()
  // prefix with /d/ to clearly indicate document path
  return `/d/${uuid}`
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id
    if (!userId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { workspaceId, title, content } = body ?? {}

    if (!workspaceId || typeof workspaceId !== 'string') {
      return NextResponse.json(
        { error: 'workspaceId required' },
        { status: 400 }
      )
    }
    if (!title || typeof title !== 'string') {
      return NextResponse.json({ error: 'title required' }, { status: 400 })
    }
    if (!content || typeof content !== 'object') {
      return NextResponse.json(
        { error: 'content (TipTap JSON) required' },
        { status: 400 }
      )
    }

    const contentError = validateTipTapContent(content)
    if (contentError) {
      return NextResponse.json({ error: contentError }, { status: 400 })
    }

    // Slug is derived from title for display only; path is UUID-based for stability
    const slug = slugify(title)
    let path = buildUuidPath()
    // Extremely unlikely, but guard against collisions
    // (best-effort single retry)
    const conflict = await prisma.document.findFirst({
      where: { workspaceId, path, deletedAt: null },
      select: { id: true },
    })
    if (conflict) {
      path = buildUuidPath()
    }

    const doc = await prisma.document.create({
      data: {
        workspaceId,
        title,
        slug,
        path,
        status: 'draft',
        authorId: userId,
        content,
      },
    })

    return NextResponse.json(
      {
        documentId: doc.id,
        slug: doc.slug,
        path: doc.path,
      },
      { status: 201 }
    )
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const workspaceId = searchParams.get('workspaceId')
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100)

    if (!workspaceId) {
      return NextResponse.json(
        { error: 'workspaceId required' },
        { status: 400 }
      )
    }

    const docs = await prisma.document.findMany({
      where: {
        workspaceId,
        deletedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        slug: true,
        path: true,
        updatedAt: true,
      },
    })

    return NextResponse.json(
      docs.map(d => ({
        documentId: d.id,
        title: d.title,
        slug: d.slug,
        path: d.path,
        updatedAt: d.updatedAt,
      }))
    )
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
