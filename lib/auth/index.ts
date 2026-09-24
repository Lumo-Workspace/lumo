/**
 * Clerk Authentication Helpers
 *
 * Re-exports Clerk server-side auth utilities for convenience.
 * Use these in Server Components and API Routes.
 *
 * Usage in Server Component:
 *   import { auth, currentUser } from '@/lib/auth'
 *   const { userId } = await auth()
 *
 * Usage in API Route:
 *   import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
 *   const authResult = await requireAuth()
 *   if (authResult instanceof NextResponse) return authResult
 */

export { auth, currentUser } from '@clerk/nextjs/server'

import { auth, currentUser } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

/**
 * Require an authenticated user.
 * Returns { userId: string } on success, or a 401 NextResponse on failure.
 */
export async function requireAuth(): Promise<
  { userId: string } | NextResponse
> {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return { userId }
}

/**
 * Require the user to be a member of the given workspace.
 * Returns the WorkspaceMember record on success, or a 403 NextResponse on failure.
 */
export async function requireWorkspaceMember(
  workspaceId: string,
  clerkId: string
) {
  const member = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_clerkId: { workspaceId, clerkId },
    },
  })
  if (!member) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return member
}

/**
 * Helper: Get the workspace for the current user.
 * Returns { workspaceId, member, workspace } or null if no workspace found.
 */
export async function getUserWorkspace(clerkId: string) {
  const member = await prisma.workspaceMember.findFirst({
    where: { clerkId },
    include: { workspace: true },
  })
  if (!member) return null
  return {
    workspaceId: member.workspaceId,
    member,
    workspace: member.workspace,
  }
}

/**
 * Emails of the signed-in user that Clerk has verified, lowercased.
 * Only these may be used to grant access (e.g. matching workspace invites).
 */
export async function getVerifiedEmails(): Promise<string[]> {
  const user = await currentUser()
  if (!user) return []
  return user.emailAddresses
    .filter(e => e.verification?.status === 'verified')
    .map(e => e.emailAddress.toLowerCase())
}

export { verifyBearer } from './bearer'

export { requireIdentity, type Identity } from './identity'
