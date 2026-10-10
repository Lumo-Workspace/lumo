/**
 * LUM-1071 — the Better Auth admin plugin, as Lumo uses it.
 *
 * What it adds (better-auth 1.7.7, plugins/admin): the `role`, `banned`,
 * `banReason`, `banExpires` columns on `auth_users` and `impersonatedBy` on
 * `auth_sessions` (migration 20261028090000_lum1071_auth_admin_fields), and a
 * `session.create.before` hook that refuses a new session for a banned user
 * (an expired ban is lifted on that sign-in). That hook is the reason the
 * plugin is enabled: banning itself is done server-side by
 * lib/services/auth-user-admin.service.ts (scripts/auth-admin/*), which also
 * deprovisions the person's memberships — the plugin's HTTP endpoints know
 * nothing about Lumo memberships.
 *
 * Its /admin/* endpoints only answer a user whose role is an admin role
 * (default ["admin"]); Lumo never assigns one (new users get "user"), so they
 * are inert. Impersonation is closed regardless: both endpoints are disabled
 * (404) and no role carries the `impersonate` permission.
 */
import { admin } from 'better-auth/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import type { BetterAuthPlugin } from 'better-auth'

/** The admin plugin's impersonation endpoints, closed in Lumo. */
export const ADMIN_DISABLED_PATHS = [
  '/admin/impersonate-user',
  '/admin/stop-impersonating',
]

/**
 * The plugin's default statements minus `impersonate` / `impersonate-admins`
 * (node_modules/better-auth/dist/plugins/admin/access/statement.mjs).
 */
const statements = {
  user: [
    'create',
    'list',
    'set-role',
    'ban',
    'delete',
    'set-password',
    'set-email',
    'get',
    'update',
  ],
  session: ['list', 'revoke', 'delete'],
} as const

const ac = createAccessControl(statements)

/** Roles: `admin` can do everything above (never impersonate); `user` nothing. */
export const ADMIN_PLUGIN_ROLES = {
  admin: ac.newRole({
    user: [...statements.user],
    session: [...statements.session],
  }),
  user: ac.newRole({ user: [], session: [] }),
}

/** The admin plugin with impersonation removed from every role. */
export function lumoAdminPlugin(): BetterAuthPlugin {
  return admin({
    defaultRole: 'user',
    adminRoles: ['admin'],
    ac,
    roles: ADMIN_PLUGIN_ROLES,
    bannedUserMessage:
      'This account has been suspended. Contact support if you believe this is an error.',
  }) as BetterAuthPlugin
}
