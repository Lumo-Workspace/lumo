import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { declarePrioritySchema } from '@/lib/validation/priority'
import { priorityService } from '@/lib/services'
import { priorityRepository } from '@/lib/repositories'

export const runtime = 'nodejs'

interface PriorityView {
  id: string
  statement: string
  effectiveFrom: string
  declaredByMemberId: string
  createdAt: string
}

function toView(p: {
  id: string
  statement: string
  effectiveFrom: Date
  declaredByMemberId: string
  createdAt: Date
}): PriorityView {
  return {
    id: p.id,
    statement: p.statement,
    effectiveFrom: p.effectiveFrom.toISOString(),
    declaredByMemberId: p.declaredByMemberId,
    createdAt: p.createdAt.toISOString(),
  }
}

/**
 * GET /api/priorities — the caller's team priority: the current declaration
 * (latest `effectiveFrom`) plus the full append history, newest first.
 * Dual-auth (bearer or Clerk) so `lumo priority create|list` and `lumo status` can use it.
 */
export async function GET(request: Request) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const teamId = await priorityRepository.findDefaultTeamId(
    identity.workspaceId
  )
  if (!teamId) {
    return NextResponse.json(
      { error: 'No default team found for this workspace' },
      { status: 404 }
    )
  }

  const history = await priorityService.listHistory(teamId)
  const current = history[0] ?? null
  return NextResponse.json({
    current: current ? toView(current) : null,
    history: history.map(toView),
  })
}

/**
 * POST /api/priorities — declare a new team priority. Append-only: every POST
 * inserts a new row scoped to the caller's team and never mutates or deletes a
 * prior declaration. A blank statement is rejected with 400 by Zod.
 */
export async function POST(request: Request) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const body = await request.json().catch(() => null)
  const parsed = declarePrioritySchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  const teamId = await priorityRepository.findDefaultTeamId(
    identity.workspaceId
  )
  if (!teamId) {
    return NextResponse.json(
      { error: 'No default team found for this workspace' },
      { status: 404 }
    )
  }

  try {
    const priority = await priorityService.declarePriority(
      teamId,
      identity.workspaceId,
      identity.memberId,
      { statement: parsed.data.statement }
    )
    return NextResponse.json({ priority: toView(priority) }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    throw error
  }
}
