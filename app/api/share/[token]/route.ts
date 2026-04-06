import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const document = await prisma.document.findUnique({
    where: { publicToken: token },
    select: {
      title: true,
      emoji: true,
      content: true,
    },
  })

  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  return NextResponse.json({ document })
}
