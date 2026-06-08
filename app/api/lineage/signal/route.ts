import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { usageSignalService } from '@/lib/services/lineage/usage-signal.service'

export async function GET(request: Request): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  const health = await usageSignalService.getUsageSignalHealth(
    identity.workspaceId
  )
  return NextResponse.json(health)
}
