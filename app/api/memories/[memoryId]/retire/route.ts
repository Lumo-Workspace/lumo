import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { memoryRepository } from '@/lib/repositories'
import { retireConfirmed } from '@/lib/services/memory/retire.service'

export const runtime = 'nodejs'

type Params = { params: Promise<{ memoryId: string }> }

/**
 * POST /api/memories/[memoryId]/retire — a human confirms a proposed memory
 * retirement (LUM-540 P4a). The memory is retired through the EXISTING status
 * machine (archiveMemories: ACTIVE→ARCHIVED, guarded + reversible) — 失效非删,
 * never a hard delete.
 *
 * RED LINE (mirrors the LUM-435 boundary-disposition / LUM-422 human-verdict
 * routes): retirement is human-only. A bearer-token identity — the agent/CLI
 * path — is refused 403 BEFORE any write, so an agent can never retire a memory
 * on its own. Retirement candidacy is computed; the *action* needs a human.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  if (identity.source !== 'clerk') {
    return NextResponse.json(
      {
        error:
          'A memory can only be retired from a human-authenticated browser session — the agent/CLI path is closed by design',
      },
      { status: 403 }
    )
  }

  const { memoryId } = await params
  const existing = await memoryRepository.findByIdWithWorkspace(memoryId)
  if (!existing)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.workspaceId !== identity.workspaceId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const retired = await retireConfirmed(memoryId)
    return NextResponse.json({ retired }, { status: 200 })
  } catch (error) {
    const maybeStatus = (error as { status?: unknown } | null)?.status
    const status = typeof maybeStatus === 'number' ? maybeStatus : 500
    const message =
      status === 500 || !(error instanceof Error)
        ? 'Internal Server Error'
        : error.message
    return NextResponse.json({ error: message }, { status })
  }
}
