import { NextRequest, NextResponse } from 'next/server'
import { documentRepository } from '@/lib/repositories/document.repository'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const document = await documentRepository.findByPublicToken(token)

  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  return NextResponse.json({ document })
}
