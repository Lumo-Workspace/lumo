import { NextResponse } from 'next/server'
import { getUserWorkspace } from '@/lib/auth'

/**
 * Validate workspaceUrl query param and verify the caller owns it.
 * Returns the workspace result or a NextResponse error.
 */
export async function requireWorkspaceByUrl(
  userId: string,
  workspaceUrl: string | null
) {
  if (!workspaceUrl) {
    return NextResponse.json(
      { error: 'workspaceUrl is required' },
      { status: 400 }
    )
  }

  const ws = await getUserWorkspace(userId)
  if (!ws || ws.workspace.slug !== workspaceUrl) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return ws
}

/**
 * Return a 400 response from a failed Zod parse, or null if valid.
 */
export function zodError(
  parsed:
    | { success: false; error: { issues: { message: string }[] } }
    | { success: true }
): NextResponse | null {
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    )
  }
  return null
}

/**
 * Check if an error is a Prisma unique constraint violation (P2002).
 */
export function isPrismaUniqueError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2002'
  )
}
