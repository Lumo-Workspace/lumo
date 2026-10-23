import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { serviceErrorResponse, zodError } from '@/lib/api/helpers'
import { createTaskDecisionSchema } from '@/lib/validation/task-decision'
import { taskDecisionService } from '@/lib/services/task-decision.service'
import { CLI_VERSION_HEADER, parseCliVersion } from '@/lib/api/cli-version'

/** The last CLI release that prefixed decisions with the local date. */
const LAST_DATE_PREFIXING_CLI: [number, number, number] = [2, 0, 0]

function prefixesDate(version: [number, number, number] | null): boolean {
  if (!version) return false
  for (let i = 0; i < 3; i++) {
    const a = version[i] as number
    const b = LAST_DATE_PREFIXING_CLI[i] as number
    if (a !== b) return a < b
  }
  return true
}

/**
 * POST /api/tasks/by-identifier/[identifier]/decisions
 *
 * Bearer-authed CLI endpoint for `lumo task decide` (LUM-970): records one
 * ruling (with an optional rationale) on the task's Decisions tab (LUM-1303).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ identifier: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) {
    return NextResponse.json(
      { error: 'Invalid or revoked API key' },
      { status: 401 }
    )
  }
  const { identifier } = await context.params

  const body = await request.json().catch(() => null)
  const parsed = createTaskDecisionSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const { task, decision } = await taskDecisionService.recordFromCli({
      workspaceId: identity.workspace.id,
      workspaceSlug: identity.workspace.slug,
      callerClerkId: identity.user.id,
      identifier,
      text: parsed.data.text,
      rationale: parsed.data.rationale,
      sourceSessionId: request.headers.get('x-lumo-session-id'),
      stripLegacyDatePrefix: prefixesDate(
        parseCliVersion(request.headers.get(CLI_VERSION_HEADER))
      ),
    })
    return NextResponse.json({ task, decision }, { status: 201 })
  } catch (error) {
    return serviceErrorResponse(
      error,
      '[POST /api/tasks/by-identifier/[identifier]/decisions]'
    )
  }
}
