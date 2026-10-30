import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, getVerifiedEmails, requireAuth } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { createWorkspaceSchema } from '@/lib/validation/schemas'
import {
  isWorkspaceApprovalRequired,
  workspaceCreationGate,
  workspaceService,
} from '@/lib/services'

/**
 * POST /api/workspaces — Create a workspace and become owner.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    // Identity is only needed by the gate; skip the lookups when it is off.
    if (isWorkspaceApprovalRequired()) {
      const user = await getCurrentUser()
      const displayName =
        [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() ||
        user?.username ||
        null
      await workspaceCreationGate.assertMayCreate({
        userId,
        verifiedEmails: await getVerifiedEmails(),
        primaryEmail:
          user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? null,
        displayName,
        now: new Date(),
      })
    }

    const body = await request.json()
    const parsed = createWorkspaceSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const result = await workspaceService.createWorkspace(userId, parsed.data)

    return NextResponse.json(
      { workspace: result.workspace, member: result.member },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      const { status, code } = error as Error & {
        status: number
        code?: string
      }
      return NextResponse.json(
        code ? { error: error.message, code } : { error: error.message },
        { status }
      )
    }
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
