import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { resolveTestCaseParam } from '@/lib/api/resolve-test-case-param'
import { taskTestCaseService } from '@/lib/services/task-test-case.service'
import { updateTestCaseBodySchema } from '@/lib/validation/test-case'
import { zodError } from '@/lib/api/helpers'
import type { TestCaseRow } from '@/lib/repositories/test-case.repository'
import type { Identity } from '@/lib/auth/identity'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; caseRef: string }> }

function errorResponse(error: unknown): NextResponse {
  const maybe = (error as { status?: unknown } | null)?.status
  const status = typeof maybe === 'number' ? maybe : 500
  const message =
    status === 500 || !(error instanceof Error)
      ? 'Internal error'
      : error.message
  return NextResponse.json({ error: message }, { status })
}

type Resolved =
  | { ok: false; response: NextResponse }
  | { ok: true; identity: Identity; testCase: TestCaseRow }

async function resolve(
  request: NextRequest,
  params: Params['params']
): Promise<Resolved> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return { ok: false, response: identity }

  const { id: rawId, caseRef } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return {
      ok: false,
      response: NextResponse.json({ error: 'Task not found' }, { status: 404 }),
    }

  const testCase = await resolveTestCaseParam(task.id, caseRef)
  if (!testCase)
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Test case not found' },
        { status: 404 }
      ),
    }

  return { ok: true, identity, testCase }
}

/** GET — one test case with its full run history. */
export async function GET(request: NextRequest, { params }: Params) {
  const r = await resolve(request, params)
  if (!r.ok) return r.response
  return NextResponse.json(await taskTestCaseService.getDetail(r.testCase.id))
}

/** PATCH — edit the case body. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const r = await resolve(request, params)
  if (!r.ok) return r.response

  const body = await request.json().catch(() => null)
  const parsed = updateTestCaseBodySchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    return NextResponse.json(
      await taskTestCaseService.update(r.testCase.id, parsed.data, {
        actorMemberId: r.identity.memberId,
        sourceSessionId: request.headers.get('X-Lumo-Session-Id'),
      })
    )
  } catch (error) {
    return errorResponse(error)
  }
}

/** DELETE — soft-delete the case; its runs stay readable. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const r = await resolve(request, params)
  if (!r.ok) return r.response

  try {
    await taskTestCaseService.remove(r.testCase.id, {
      actorMemberId: r.identity.memberId,
      sourceSessionId: request.headers.get('X-Lumo-Session-Id'),
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
