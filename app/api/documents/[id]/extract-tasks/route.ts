import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { extractTasksSchema } from '@/lib/validation/extract-tasks.schema'
import { extractTasksFromDoc } from '@/lib/services/document-task-extraction.service'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = extractTasksSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    )
  }

  try {
    const result = await extractTasksFromDoc({
      documentId: id,
      memberId: identity.memberId,
      callerClerkId: identity.clerkId,
      workspaceId: identity.workspaceId,
      content: parsed.data.content,
      selector: parsed.data.selector,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500
    const code = (err as { code?: string })?.code
    const message =
      status === 500
        ? 'Internal Server Error'
        : err instanceof Error
          ? err.message
          : 'Error'
    if (status === 500) {
      console.error('POST /api/documents/[id]/extract-tasks error:', err)
    }
    return NextResponse.json(
      code ? { error: message, code } : { error: message },
      { status }
    )
  }
}
