import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireIdentity } from '@/lib/auth/identity'
import {
  defaultReportWindow,
  reportService,
} from '@/lib/services/report.service'

const querySchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  member: z.string().min(1).optional(),
  project: z.string().min(1).optional(),
  limit: z.coerce.number().int().optional(),
})

/**
 * GET /api/report — LUM-1100 `lumo usage show --tasks`: token usage + tasks completed in
 * the half-open window [since, until). Defaults to the last 7 days. Scoped to
 * the caller's workspace; `member` narrows to one WorkspaceMember id.
 */
export async function GET(request: Request): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const url = new URL(request.url)
  const parsed = querySchema.safeParse(
    Object.fromEntries(url.searchParams.entries())
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', issues: parsed.error.issues },
      { status: 400 }
    )
  }
  const q = parsed.data
  const until = q.until ? new Date(q.until) : new Date()
  const since = q.since ? new Date(q.since) : defaultReportWindow(until).since

  try {
    const report = await reportService.getReport(identity.workspaceId, {
      since,
      until,
      memberId: q.member,
      projectRef: q.project,
      limit: q.limit,
    })
    return NextResponse.json(report)
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
