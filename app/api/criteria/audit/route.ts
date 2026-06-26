import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { criteriaAuditService } from '@/lib/services/criteria-audit.service'

export async function GET(request: Request): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  const report = await criteriaAuditService.forWorkspace(identity.workspaceId)
  return NextResponse.json(report)
}
