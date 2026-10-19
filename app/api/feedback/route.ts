import { NextRequest, NextResponse } from 'next/server'
import type { FeedbackSource } from '@prisma/client'
import { requireIdentity } from '@/lib/auth'
import { errorResponse } from '@/lib/api/route-error'
import { CLI_VERSION_HEADER } from '@/lib/api/cli-version'
import {
  feedbackService,
  FeedbackRateLimitError,
} from '@/lib/services/feedback.service'
import {
  createFeedbackPayloadSchema,
  listFeedbackQuerySchema,
} from '@/lib/validation/feedback'

export const runtime = 'nodejs'
export const maxDuration = 60

const SESSION_HEADER = 'X-Lumo-Session-Id'

/** Where a submission came from — known from the request, independent of --no-env. */
function sourceOf(request: NextRequest, source: string): FeedbackSource {
  if (request.headers.get(CLI_VERSION_HEADER)) return 'CLI'
  return source === 'clerk' ? 'WEB' : 'API'
}

/**
 * POST /api/feedback — LUM-1240: report a bug / idea / question to the Lumo
 * team. multipart/form-data: one `payload` part (JSON, see
 * createFeedbackPayloadSchema) and 0–5 `file` parts (evidence). One request,
 * so a report is never created without its evidence or vice versa.
 *
 * `requireIdentity` — an agent with an API key may file directly (no
 * confirmation envelope, user ruling 2026-10-19). 429 carries
 * `{ code: 'RATE_LIMITED', scope, window, limit, retryAt }`.
 */
export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const form = await request.formData().catch(() => null)
  if (!form)
    return NextResponse.json(
      { error: 'Expected multipart/form-data' },
      { status: 400 }
    )
  const raw = form.get('payload')
  let json: unknown = null
  try {
    json = typeof raw === 'string' ? JSON.parse(raw) : null
  } catch {
    json = null
  }
  const parsed = createFeedbackPayloadSchema.safeParse(json)
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid feedback payload', issues: parsed.error.issues },
      { status: 400 }
    )
  const files = form.getAll('file').filter((f): f is File => f instanceof File)

  try {
    const sessionId = request.headers.get(SESSION_HEADER)?.slice(0, 200) || null
    const result = await feedbackService.create(
      {
        workspaceId: identity.workspaceId,
        memberId: identity.memberId,
        submittedVia: sourceOf(request, identity.source),
        sessionId,
        origin: new URL(request.url).origin,
      },
      parsed.data,
      files
    )
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof FeedbackRateLimitError)
      return NextResponse.json(
        { error: error.message, ...error.details },
        { status: 429 }
      )
    return errorResponse(error)
  }
}

/** GET /api/feedback — the caller's workspace's reports, newest first. */
export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const parsed = listFeedbackQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  )
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid query', issues: parsed.error.issues },
      { status: 400 }
    )
  try {
    return NextResponse.json(
      await feedbackService.list(
        { workspaceId: identity.workspaceId, memberId: identity.memberId },
        parsed.data
      )
    )
  } catch (error) {
    return errorResponse(error)
  }
}
