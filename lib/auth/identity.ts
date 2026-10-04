import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { verifyBearer } from './bearer'
import { resolveActiveMembership } from './index'
import {
  ACTIVE_WORKSPACE_HEADER,
  normalizeActiveSlug,
} from '@/lib/workspace/active-workspace'
import { miscRepository } from '@/lib/repositories/misc.repository'

/**
 * Unified identity for routes that accept both browser sessions (Clerk) and
 * CLI bearer tokens. Routes get the same fields regardless of how the caller
 * authenticated, so they can drop the per-source branching.
 *
 * `clerkId` is the human user id, `memberId` is the WorkspaceMember row id,
 * and `workspaceId/Slug/Name` describe the resolved workspace. `source`
 * tells the route which scheme was used — handy for logging or to gate
 * features that should stay browser-only.
 */
export interface Identity {
  clerkId: string
  memberId: string
  workspaceId: string
  workspaceSlug: string
  workspaceName: string
  source: 'bearer' | 'clerk'
}

/**
 * Authenticate a request via either `Authorization: Bearer <api-key>` or a
 * Clerk browser session. Bearer is tried first because it's a cheap DB
 * lookup; Clerk is fall-back.
 *
 * Returns the resolved `Identity` on success, or a `NextResponse` (401 /
 * 403 / 404) the route should return directly.
 *
 * - 401 if no credential was presented or the bearer token is invalid.
 * - 404 if the Clerk user has no workspace yet (matches the previous
 *   `requireUserWorkspace` behavior).
 * - 403 if a multi-workspace Clerk user names (via `X-Lumo-Workspace`) a
 *   workspace they don't belong to.
 *
 * Clerk sessions (LUM-987): the workspace is the ACTIVE one — the slug of the
 * `/workspace/<slug>/…` page the browser's `apiFetch` sends as
 * `X-Lumo-Workspace`; without it, the user's oldest membership (deterministic).
 * A single-workspace user always resolves to their one workspace. Bearer keys
 * ignore the header: a key is bound to its own workspace.
 */
export async function requireIdentity(
  request: Request
): Promise<Identity | NextResponse> {
  // 1. Bearer (CLI / MCP / scripts) ────────────────────────────────────
  const bearer = await verifyBearer(request)
  if (bearer) {
    const memberId = await miscRepository.findMemberIdForHook(
      bearer.user.id,
      bearer.workspace.id
    )
    if (!memberId) {
      return NextResponse.json(
        { error: 'API key references a member that no longer exists' },
        { status: 403 }
      )
    }
    return {
      clerkId: bearer.user.id,
      memberId,
      workspaceId: bearer.workspace.id,
      workspaceSlug: bearer.workspace.slug,
      workspaceName: bearer.workspace.name,
      source: 'bearer',
    }
  }

  // 2. Clerk session (browser) ─────────────────────────────────────────
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { active, count } = await resolveActiveMembership(
    userId,
    normalizeActiveSlug(request.headers.get(ACTIVE_WORKSPACE_HEADER))
  )
  if (count === 0) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
  }
  if (!active) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return {
    clerkId: userId,
    memberId: active.id,
    workspaceId: active.workspaceId,
    workspaceSlug: active.workspace.slug,
    workspaceName: active.workspace.name,
    source: 'clerk',
  }
}
