/**
 * LUM-1335 — the Better Auth side of `LUMO_MODE=local` (../local-mode).
 *
 * GET {basePath}/lumo/local-sign-in?redirect_url=<path> signs the browser in
 * as the instance's one user and sends it on to <path>. With no user yet it
 * creates one (an ordinary `auth_users` row, so its workspaces survive turning
 * the mode off); with more than one it refuses — a team instance is never
 * handed to whoever opens it. The plugin is only registered in local mode, so
 * the endpoint does not exist otherwise.
 */
import { createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import type { BetterAuthPlugin } from 'better-auth'
import { LOCAL_USER_EMAIL, LOCAL_USER_NAME } from '../local-mode'
import { REDIRECT_PARAM_NAME, safeRedirectTarget } from './sign-in-helpers'

export const LOCAL_SIGN_IN_ENDPOINT = '/lumo/local-sign-in'

export const LOCAL_MODE_MULTIPLE_USERS = 'local_mode_multiple_users'

/** Answer when the instance already has several accounts. */
export const MULTIPLE_USERS_MESSAGE =
  'LUMO_MODE=local only runs while this instance has at most one account, and it has several. ' +
  'Remove LUMO_MODE from .env and sign in with your account.'

export interface LocalModePluginOptions {
  /**
   * Runs after the session is created, before the redirect (LUM-1335: gives
   * the account a workspace). A failure is only logged — signing in never
   * depends on it.
   */
  onSignIn?: (userId: string) => Promise<void>
  onSignInError?: (err: unknown) => void
}

export function lumoLocalModePlugin(opts: LocalModePluginOptions = {}) {
  return {
    id: 'lumo-local-mode',
    endpoints: {
      lumoLocalSignIn: createAuthEndpoint(
        LOCAL_SIGN_IN_ENDPOINT,
        { method: 'GET' },
        async ctx => {
          const adapter = ctx.context.internalAdapter
          const users = await adapter.listUsers(2)
          if (users.length > 1) {
            ctx.setStatus(409)
            return ctx.json({
              error: LOCAL_MODE_MULTIPLE_USERS,
              message: MULTIPLE_USERS_MESSAGE,
            })
          }
          let user = users[0]
          if (!user) {
            try {
              user = await adapter.createUser(
                {
                  email: LOCAL_USER_EMAIL,
                  name: LOCAL_USER_NAME,
                  emailVerified: true,
                },
                { method: 'local-mode' }
              )
            } catch (err) {
              // Two first visits at once: the other one created it.
              const existing = await adapter.findUserByEmail(LOCAL_USER_EMAIL)
              if (!existing) throw err
              user = existing.user
            }
          }
          const session = await adapter.createSession(user.id)
          await setSessionCookie(ctx, { session, user })
          if (opts.onSignIn) {
            try {
              await opts.onSignIn(user.id)
            } catch (err) {
              opts.onSignInError?.(err)
            }
          }
          const back = (ctx.query as Record<string, unknown> | undefined)?.[
            REDIRECT_PARAM_NAME
          ]
          throw ctx.redirect(
            safeRedirectTarget(typeof back === 'string' ? back : null)
          )
        }
      ),
    },
  } satisfies BetterAuthPlugin
}
