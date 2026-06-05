import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { documentTemplateService } from '@/lib/services/document-template.service'

export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const templates = await documentTemplateService.listTemplates(
    identity.workspaceId
  )
  return NextResponse.json({ templates })
}
