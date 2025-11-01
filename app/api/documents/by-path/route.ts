import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const workspaceId = searchParams.get('workspaceId')
    const path = searchParams.get('path')

    if (!workspaceId || !path) {
      return NextResponse.json(
        { error: 'workspaceId and path required' },
        { status: 400 }
      )
    }

    const doc = await prisma.document.findFirst({
      where: { workspaceId, path, deletedAt: null },
    })

    if (!doc) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({
      documentId: doc.id,
      title: doc.title,
      content: doc.content,
      updatedAt: doc.updatedAt,
    })
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
