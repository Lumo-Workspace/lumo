import { NextRequest, NextResponse } from 'next/server'
import { isLocalMode } from '@/lib/auth/local-mode'
import { memberAuditContext } from '@/lib/api/audit-context'
import { localModeService } from '@/lib/services/local-mode.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/local/cli-key — LUM-1335. Under `LUMO_MODE=local` only: a new
 * API key for the instance's one account, so `lumo auth login --url …`
 * connects without a browser or copy-paste. No credential, like the local
 * sign-in itself: anyone who can reach a local-mode instance is signed in.
 * Any other mode answers 404, which the CLI takes as "paste a key instead".
 */
export async function POST(request: NextRequest) {
  if (!isLocalMode()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    const result = await localModeService.issueCliKey(
      memberAuditContext(request.headers, {}, 'bearer')
    )
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
