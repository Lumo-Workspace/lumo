/**
 * Test-only seed for the LUM-946 /sessions/[id] access suites: two workspaces
 * and one viewer per access case, on a PGlite harness.
 */
import type { PgliteHarness } from './pglite-harness'

/** Session ids. */
export const SESSION_ACCESS = {
  /** Root session of `member` in workspace A. */
  root: 'acc-root',
  /** Subagent session of the root (same member, same workspace). */
  child: 'acc-root:agent1',
  /** A session in workspace B. */
  inB: 'acc-in-b',
  /** A child in workspace A whose parent lives in workspace B. */
  strayChild: 'acc-in-b:agent9',
} as const

/** Clerk ids of the viewers. */
export const VIEWER = {
  /** The session's own member (MEMBER of A). */
  member: 'clerk-member',
  /** OWNER of workspace A. */
  ownerA: 'clerk-owner-a',
  /** Another MEMBER of workspace A. */
  otherMember: 'clerk-other-member',
  /** OWNER of workspace B and a plain MEMBER of A. */
  ownerBMemberA: 'clerk-owner-b',
  /** OWNER of workspace B only — not in A at all. */
  ownerBOnly: 'clerk-owner-b-only',
  /** Signed in, member of no workspace here. */
  stranger: 'clerk-stranger',
} as const

export async function seedSessionAccess(harness: PgliteHarness): Promise<void> {
  await harness.insert('workspaces', { id: 'wsA', name: 'A', slug: 'ws-a' })
  await harness.insert('workspaces', { id: 'wsB', name: 'B', slug: 'ws-b' })
  const member = (
    id: string,
    workspaceId: string,
    clerkId: string,
    role: 'OWNER' | 'MEMBER'
  ) =>
    harness.insert('workspace_members', { id, workspaceId, clerkId, role })
  await member('mA-member', 'wsA', VIEWER.member, 'MEMBER')
  await member('mA-owner', 'wsA', VIEWER.ownerA, 'OWNER')
  await member('mA-other', 'wsA', VIEWER.otherMember, 'MEMBER')
  await member('mA-ownerB', 'wsA', VIEWER.ownerBMemberA, 'MEMBER')
  await member('mB-owner', 'wsB', VIEWER.ownerBMemberA, 'OWNER')
  await member('mB-owner-only', 'wsB', VIEWER.ownerBOnly, 'OWNER')

  const at = new Date(Date.UTC(2026, 9, 4, 0, 0, 0)).toISOString()
  const session = (
    id: string,
    workspaceId: string,
    workspaceMemberId: string,
    extra: Record<string, unknown> = {}
  ) =>
    harness.insert('sessions', {
      id,
      workspaceId,
      workspaceMemberId,
      startedAt: at,
      lastActivityAt: at,
      ...extra,
    })
  await session(SESSION_ACCESS.root, 'wsA', 'mA-member', { cwd: '/repo' })
  await session(SESSION_ACCESS.child, 'wsA', 'mA-member', {
    parentSessionId: SESSION_ACCESS.root,
    agentId: 'agent1',
    agentType: 'Explore',
  })
  await session(SESSION_ACCESS.inB, 'wsB', 'mB-owner')
  await session(SESSION_ACCESS.strayChild, 'wsA', 'mA-member', {
    parentSessionId: SESSION_ACCESS.inB,
    agentId: 'agent9',
  })
}
