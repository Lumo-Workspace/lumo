import { NextResponse } from 'next/server'
import { notificationRepository } from '@/lib/repositories/notification.repository'
import { validateMcpToken } from '@/lib/auth/mcp-auth'

/**
 * GET /api/agent/mcp-clarify/:id
 *
 * Polled by the MCP server inside the E2B sandbox to check whether the
 * user has replied to a clarification request. Returns the reply text
 * when available, or `{ status: 'pending' }` otherwise.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const clarify = await notificationRepository.findClarifyForPoll(id)

    if (!clarify) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const authorized = await validateMcpToken(request, clarify.taskId)
    if (!authorized) {
      // Return 404 (not 401) to avoid leaking whether this clarify ID exists
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (clarify.reply != null) {
      return NextResponse.json({ status: 'replied', reply: clarify.reply })
    }

    return NextResponse.json({ status: 'pending' })
  } catch (error) {
    console.error('[mcp-clarify/get] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
