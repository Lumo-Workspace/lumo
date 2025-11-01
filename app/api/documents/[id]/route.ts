import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { validateTipTapContent } from '@/utils/validation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/config'

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const doc = await prisma.document.findUnique({
      where: { id },
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id
    if (!userId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const body = await req.json()
    const { title, content } = body ?? {}

    const existing = await prisma.document.findUnique({ where: { id } })
    if (!existing)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (content) {
      const contentError = validateTipTapContent(content)
      if (contentError) {
        return NextResponse.json({ error: contentError }, { status: 400 })
      }
    }

    const updated = await prisma.document.update({
      where: { id },
      data: {
        title: title ?? existing.title,
        content: content ?? existing.content,
        updatedById: userId,
      },
      select: { id: true },
    })

    return NextResponse.json({
      documentId: updated.id,
    })
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await prisma.document.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
