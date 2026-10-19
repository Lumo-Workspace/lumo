import { NextResponse } from 'next/server'
import { requireIdentity, type Identity } from '@/lib/auth/identity'
import { memberRepository } from '@/lib/repositories/member.repository'

/**
 * LUM-1240 batch 2 — who counts as Lumo staff (the Lumo team triaging
 * customer feedback across workspaces).
 *
 * User ruling 2026-10-19 (RFC §6.1 option A): a workspace-id allowlist in
 * `LUMO_STAFF_WORKSPACE_IDS` (comma-separated). There is no in-product way to
 * grant it, and a deployment that does not set it has no staff at all.
 *
 * Narrowed further: only an OWNER of an allowlisted workspace is staff. The
 * workspace allowlist alone would hand cross-tenant read access to every
 * member of that workspace — and to every API key those members create (an
 * agent key, a CI key). Requiring the OWNER role keeps the grant to the
 * people who already control the staff workspace's membership, for both
 * Clerk sessions and API keys.
 *
 * Every staff route and the staff branch of the file route go through
 * `isLumoStaff` and nothing else.
 */

export const STAFF_WORKSPACE_IDS_ENV = 'LUMO_STAFF_WORKSPACE_IDS'

/** The allowlisted workspace ids; empty when unset. */
export function staffWorkspaceIds(
  env: Record<string, string | undefined> = process.env
): Set<string> {
  return new Set(
    (env[STAFF_WORKSPACE_IDS_ENV] ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  )
}

/**
 * True when the caller is an active OWNER of an allowlisted workspace. Any
 * lookup failure answers false (no staff rights on doubt).
 */
export async function isLumoStaff(
  identity: Pick<Identity, 'workspaceId' | 'memberId'>,
  env: Record<string, string | undefined> = process.env
): Promise<boolean> {
  if (!staffWorkspaceIds(env).has(identity.workspaceId)) return false
  try {
    const member = await memberRepository.findById(identity.memberId)
    return (
      member !== null &&
      member.workspaceId === identity.workspaceId &&
      member.role === 'OWNER'
    )
  } catch {
    return false
  }
}

/**
 * Route guard: the caller's identity when they are staff, otherwise the
 * response to return (401 unauthenticated, 403 not staff).
 */
export async function requireStaff(
  request: Request
): Promise<Identity | NextResponse> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  if (!(await isLumoStaff(identity)))
    return NextResponse.json(
      { error: 'Only the Lumo team can use this endpoint' },
      { status: 403 }
    )
  return identity
}
