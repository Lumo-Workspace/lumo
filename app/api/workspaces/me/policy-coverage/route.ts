import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { serviceErrorResponse } from '@/lib/api/helpers'
import { policyCoverageService } from '@/ee/security/services/policy-coverage.service'

/**
 * GET /api/workspaces/me/policy-coverage — for each project of the caller's
 * workspace, the CLAUDE.md / AGENTS.md rules no detector checks automatically
 * (LUM-1114). Any member may read; only the caller's own workspace.
 * Browser session or CLI bearer.
 */
export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  try {
    const coverage = await policyCoverageService.get(identity)
    return NextResponse.json(coverage, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    return serviceErrorResponse(
      error,
      '[GET /api/workspaces/me/policy-coverage]'
    )
  }
}
