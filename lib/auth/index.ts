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
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import {
  ACTIVE_WORKSPACE_HEADER,
  normalizeActiveSlug,
} from '@/lib/workspace/active-workspace'

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

// ── Active workspace (LUM-987) ──────────────────────────────────────────────

/**
 * The `X-Lumo-Workspace` slug of the request being handled (sent by the
 * browser's `apiFetch` from the `/workspace/<slug>/…` URL), or null when
 * absent or when called outside a request scope.
 */
export async function readActiveWorkspaceSlug(): Promise<string | null> {
  try {
    return normalizeActiveSlug((await headers()).get(ACTIVE_WORKSPACE_HEADER))
  } catch {
    return null
  }
}

/**
 * Pinned default order of a user's memberships: oldest join first, id as the
 * tie-break. The no-slug fallback is the first one — deterministic, unlike
 * the unordered `findFirst` it replaces.
 */
const MEMBERSHIP_ORDER = [{ joinedAt: 'asc' as const }, { id: 'asc' as const }]

/**
 * Resolve a Clerk user's ACTIVE workspace membership.
 *
 * - exactly one membership → that one, whatever the slug says (a
 *   single-workspace user's behavior never depends on the slug);
 * - several, slug given → the membership in that workspace, or null when the
 *   user doesn't belong to it (never a silent fallback to another one);
 * - several, no slug → the oldest membership (`MEMBERSHIP_ORDER`).
 *
 * `count` is the user's membership total, so callers can tell "no workspace
 * at all" from "not a member of the requested one".
 */
export async function resolveActiveMembership(
  clerkId: string,
  slug: string | null
) {
  const memberships = await prisma.workspaceMember.findMany({
    where: { clerkId },
    include: { workspace: true },
    orderBy: MEMBERSHIP_ORDER,
  })
  const count = memberships.length
  if (count <= 1 || slug === null) {
    return { active: memberships[0] ?? null, count }
  }
  return {
    active: memberships.find(m => m.workspace.slug === slug) ?? null,
    count,
  }
}

/**
 * The membership row of `clerkId` in `workspaceId`, membership only — no
 * active-workspace check. For callers whose workspace is already the
 * credential's own (a Bearer key's workspace, or the active workspace
 * `requireIdentity` resolved). Returns the row or a 403.
 */
export async function requireWorkspaceMembership(
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
 * Require a CLERK SESSION user to be a member of the given (resource's)
 * workspace, and that workspace to be the session's active one.
 * Returns the WorkspaceMember record on success; 403 when not a member at
 * all (unchanged), 404 when a member but the workspace isn't the active one
 * (LUM-987 — a multi-workspace session is scoped like a Bearer key; same
 * opaque 404 as a missing resource). A single-workspace user can only be a
 * member of their active workspace, so their result is unchanged.
 */
export async function requireWorkspaceMember(
  workspaceId: string,
  clerkId: string
) {
  const member = await requireWorkspaceMembership(workspaceId, clerkId)
  if (member instanceof NextResponse) return member
  const { active, count } = await resolveActiveMembership(
    clerkId,
    await readActiveWorkspaceSlug()
  )
  if (count > 1 && active?.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return member
}

/**
 * Helper: Get the ACTIVE workspace of the current Clerk user (LUM-987).
 * `slug` defaults to the request's `X-Lumo-Workspace` header; pass it
 * explicitly when the caller already has it (a URL param, a query string).
 * Returns { workspaceId, member, workspace } or null — no membership at all,
 * or (multi-workspace user) not a member of the requested slug.
 */
export async function getUserWorkspace(clerkId: string, slug?: string | null) {
  const activeSlug = slug === undefined ? await readActiveWorkspaceSlug() : slug
  const { active } = await resolveActiveMembership(clerkId, activeSlug)
  if (!active) return null
  return {
    workspaceId: active.workspaceId,
    member: active,
    workspace: active.workspace,
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
