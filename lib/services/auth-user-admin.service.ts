/**
 * LUM-1071 — banning, un-banning and removing a user in Better Auth mode, the
 * server-side replacement for Clerk Dashboard + the Clerk webhook (RFC
 * LUM-1069 §5). Called by scripts/auth-admin/{ban,unban,remove}.ts, which an
 * operator runs against the database (dry run unless --confirm).
 *
 * Ban: set the admin plugin's ban fields (its session hook then refuses every
 * new sign-in), delete the user's sessions and MCP OAuth tokens, and
 * deprovision every workspace membership exactly like the Clerk webhook does
 * (memberDeprovisionService.deprovisionUser: deactivated, API keys revoked,
 * audited; the last OWNER of a workspace keeps the row, their keys revoked).
 * Remove: deprovision, then delete the auth user (sessions, linked accounts
 * and tokens cascade). Refused while the user is the last active OWNER of a
 * workspace — deleting the identity would leave the workspace with an OWNER
 * nobody can sign in as; transfer ownership first, or ban instead.
 * Un-ban: clear the ban fields only. Memberships are NOT restored (same as
 * un-banning in Clerk): only a new invite brings the person back.
 *
 * Idempotent: re-running a ban rewrites the same fields and finds nothing to
 * revoke or deactivate; re-running a remove after it finished reports
 * `already_removed` (see wasRemovedHere for when that can be proven; an id
 * that never existed is a 404). A failed personal-integration cleanup throws (500) after
 * the deactivation, and a re-run finishes it.
 */
import { PLATFORM_ADMIN_ROLE } from '@/lib/auth/platform-admin-role'
import { logger } from '@/lib/logger'
import { memberRepository } from '@/lib/repositories/member.repository'
import {
  authUserAdminRepository,
  type AuthUserBanState,
} from '@/lib/repositories/auth-user-admin.repository'
import {
  SYSTEM_AUDIT_CONTEXT,
  type AuditContext,
} from '@/lib/services/audit.service'
import {
  memberDeprovisionService,
  type DeprovisionOutcome,
  type DeprovisionPlanEntry,
} from '@/lib/services/member-deprovision.service'

/** The admin plugin's defaultRole (lib/auth/better-auth/admin-plugin.ts). */
const DEFAULT_USER_ROLE = 'user'

/** Audit metadata marking deprovisioning done by these operations. */
const AUDIT_TRIGGER = { trigger: 'auth-admin' } as const

export interface AuthAdminTarget {
  userId?: string | undefined
  email?: string | undefined
}

/** Everything a dry run reports — ids and counts, never personal data. */
export interface AuthAdminPlan {
  userId: string
  /** null: no Better Auth user with this id. */
  user: AuthUserBanState | null
  sessions: number
  oauthTokens: number
  memberships: DeprovisionPlanEntry[]
}

export interface BanOptions {
  reason?: string | null | undefined
  expiresAt?: Date | null | undefined
}

export interface BanResult {
  userId: string
  wasBanned: boolean
  sessionsRevoked: number
  oauthTokensRevoked: number
  memberships: DeprovisionOutcome[]
}

export interface UnbanResult {
  userId: string
  changed: boolean
}

/** LUM-1344 — the outcome of granting or revoking platform admin. */
export interface PlatformAdminRoleResult {
  userId: string
  role: string
  changed: boolean
}

export type RemoveResult =
  | {
      userId: string
      outcome: 'removed'
      sessionsRevoked: number
      oauthTokensRevoked: number
      memberships: DeprovisionOutcome[]
    }
  | { userId: string; outcome: 'already_removed' }

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

/** Workspaces where removing the user would leave no OWNER. */
export function lastOwnerWorkspaces(plan: DeprovisionPlanEntry[]): string[] {
  return plan
    .filter(e => e.action === 'keep_last_owner')
    .map(e => e.workspaceId)
}

/**
 * Membership reasons only this service writes. `ban` needs an existing
 * Better Auth user, so a membership carrying one of them proves the id WAS a
 * user here; with the user now gone, the only way it went is `remove`
 * (Lumo exposes no other deletion: the admin plugin's endpoints are inert and
 * self-service deletion is off).
 */
export const AUTH_ADMIN_REASONS = [
  'AUTH_USER_BANNED',
  'AUTH_USER_DELETED',
] as const

/**
 * Whether a missing user is one this service removed: no live membership is
 * left, and at least one carries an AUTH_ADMIN_REASONS reason. A removal that
 * left no such trace (the user had no membership, or every one had already
 * been removed / left under another reason) cannot be told apart from an id
 * that never existed, and reports not found — still writing nothing.
 */
async function wasRemovedHere(
  userId: string,
  plan: DeprovisionPlanEntry[]
): Promise<boolean> {
  if (plan.length === 0 || plan.some(e => e.action !== 'none')) return false
  return (
    (await memberRepository.countDeactivatedByReasons(
      userId,
      AUTH_ADMIN_REASONS
    )) > 0
  )
}

async function requireUser(userId: string): Promise<AuthUserBanState> {
  const user = await authUserAdminRepository.findBanState(userId)
  if (!user) throw httpError(`No Better Auth user with id ${userId}`, 404)
  return user
}

export const authUserAdminService = {
  /**
   * The user id a target names: `userId` as given, or the user with `email`.
   * Exactly one of the two. 400 / 404 otherwise.
   */
  async resolveUserId(target: AuthAdminTarget): Promise<string> {
    const userId = target.userId?.trim()
    const email = target.email?.trim()
    if (!userId === !email) {
      throw httpError('Pass exactly one of --user-id or --email', 400)
    }
    if (userId) return userId
    const found = await authUserAdminRepository.findIdByEmail(email!)
    if (!found) throw httpError('No Better Auth user with that email', 404)
    return found
  },

  /** What ban / remove would touch, without writing anything. */
  async plan(userId: string): Promise<AuthAdminPlan> {
    const user = await authUserAdminRepository.findBanState(userId)
    const credentials = user
      ? await authUserAdminRepository.countCredentials(userId)
      : { sessions: 0, oauthTokens: 0 }
    const memberships = await memberDeprovisionService.planDeprovision(userId)
    return { userId, user, ...credentials, memberships }
  },

  async ban(
    userId: string,
    options: BanOptions = {},
    audit: AuditContext = SYSTEM_AUDIT_CONTEXT
  ): Promise<BanResult> {
    const user = await requireUser(userId)
    // The ban lands first: from here on no new session can be created, so
    // nothing below can be raced by a fresh sign-in.
    const revoked = await authUserAdminRepository.banAndRevoke(userId, {
      reason: options.reason ?? null,
      expiresAt: options.expiresAt ?? null,
    })
    const memberships = await memberDeprovisionService.deprovisionUser(
      { userId, reason: 'AUTH_USER_BANNED', auditMetadata: AUDIT_TRIGGER },
      audit
    )
    logger.info('[auth-admin] user banned', {
      userId,
      wasBanned: user.banned,
      ...revoked,
      memberships: memberships.length,
    })
    return { userId, wasBanned: user.banned, ...revoked, memberships }
  },

  async unban(userId: string): Promise<UnbanResult> {
    await requireUser(userId)
    const changed = await authUserAdminRepository.clearBan(userId)
    logger.info('[auth-admin] user unbanned', { userId, changed })
    return { userId, changed }
  },

  /**
   * LUM-1344 — make a user a platform admin (`role = 'admin'`), the role
   * requirePlatformAdmin checks on every /api/admin request. Refused (409)
   * for a banned user: the guard would refuse them anyway, and granting it
   * would silently return once the ban is lifted.
   */
  async grantPlatformAdmin(userId: string): Promise<PlatformAdminRoleResult> {
    const user = await requireUser(userId)
    if (user.banned) {
      throw httpError(`User ${userId} is banned; unban first`, 409)
    }
    const changed = user.role !== PLATFORM_ADMIN_ROLE
    if (changed) {
      await authUserAdminRepository.setRole(userId, PLATFORM_ADMIN_ROLE)
    }
    logger.info('[auth-admin] platform admin granted', { userId, changed })
    return { userId, role: PLATFORM_ADMIN_ROLE, changed }
  },

  /**
   * LUM-1344 — take platform admin away (`role = 'user'`, the plugin's
   * default). Takes effect on the next /api/admin request: the guard reads
   * the role every time, so tokens already issued stop working.
   */
  async revokePlatformAdmin(userId: string): Promise<PlatformAdminRoleResult> {
    const user = await requireUser(userId)
    const changed = user.role === PLATFORM_ADMIN_ROLE
    if (changed) {
      await authUserAdminRepository.setRole(userId, DEFAULT_USER_ROLE)
    }
    logger.info('[auth-admin] platform admin revoked', { userId, changed })
    return {
      userId,
      role: changed ? DEFAULT_USER_ROLE : (user.role ?? DEFAULT_USER_ROLE),
      changed,
    }
  },

  async remove(
    userId: string,
    audit: AuditContext = SYSTEM_AUDIT_CONTEXT
  ): Promise<RemoveResult> {
    const user = await authUserAdminRepository.findBanState(userId)
    const plan = await memberDeprovisionService.planDeprovision(userId)
    if (!user) {
      if (await wasRemovedHere(userId, plan)) {
        return { userId, outcome: 'already_removed' }
      }
      // Never existed here (a typo, a Clerk-only id, a user who left before):
      // say so instead of pretending a removal happened. Nothing is written.
      throw httpError(`No Better Auth user with id ${userId}`, 404)
    }
    const blocked = lastOwnerWorkspaces(plan)
    if (blocked.length > 0) {
      throw httpError(
        `User is the last OWNER of workspace(s) ${blocked.join(', ')}; transfer ownership first, or ban instead`,
        409
      )
    }
    const memberships = await memberDeprovisionService.deprovisionUser(
      { userId, reason: 'AUTH_USER_DELETED', auditMetadata: AUDIT_TRIGGER },
      audit
    )
    // An OWNER may have left between the plan and now: never delete the
    // identity behind a workspace's only OWNER.
    const keptOwner = memberships.filter(m => m.outcome === 'last_owner_kept')
    if (keptOwner.length > 0) {
      throw httpError(
        `User became the last OWNER of workspace(s) ${keptOwner
          .map(m => m.workspaceId)
          .join(', ')}; not removed`,
        409
      )
    }
    const deleted = await authUserAdminRepository.deleteUser(userId)
    logger.info('[auth-admin] user removed', {
      userId,
      sessionsRevoked: deleted.sessionsRevoked,
      oauthTokensRevoked: deleted.oauthTokensRevoked,
      memberships: memberships.length,
    })
    return {
      userId,
      outcome: 'removed',
      sessionsRevoked: deleted.sessionsRevoked,
      oauthTokensRevoked: deleted.oauthTokensRevoked,
      memberships,
    }
  },
}
