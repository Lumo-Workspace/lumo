/**
 * LUM-1335 — the Better Auth side of `LUMO_MODE=local` (../local-mode).
 *
 * Two endpoints, registered only in local mode (they do not exist otherwise),
 * both for the instance's one account — created on first use when there is
 * none (an ordinary `auth_users` row, so its workspaces survive turning the
 * mode off), refused when there are several (a team instance is never handed
 * to whoever reaches it):
 *
 *   GET  {basePath}/lumo/local-sign-in?redirect_url=<path> — signs the
 *        browser in and sends it on to <path>;
 *   POST {basePath}/lumo/local-cli-key — a new API key for `lumo auth login
 *        --url …`, so the CLI connects with nothing to paste, even before
 *        anyone opened the app. A POST, so Better Auth's origin check turns a
 *        cross-site browser request away.
 */
import { createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import type { BetterAuthPlugin, User } from 'better-auth'
import { LOCAL_USER_EMAIL, LOCAL_USER_NAME } from '../local-mode'
import { REDIRECT_PARAM_NAME, safeRedirectTarget } from './sign-in-helpers'

export const LOCAL_SIGN_IN_ENDPOINT = '/lumo/local-sign-in'
export const LOCAL_CLI_KEY_ENDPOINT = '/lumo/local-cli-key'

export const LOCAL_MODE_MULTIPLE_USERS = 'local_mode_multiple_users'

/** Answer when the instance already has several accounts. */
export const MULTIPLE_USERS_MESSAGE =
  'LUMO_MODE=local only runs while this instance has at most one account, and it has several. ' +
  'Remove LUMO_MODE from .env and sign in with your account.'

export interface LocalCliKey {
  key: string
  workspaceSlug: string
}

export interface LocalModePluginOptions {
  /**
   * Runs after the session is created, before the redirect (gives the account
   * a workspace). A failure is only logged — signing in never depends on it.
   */
  onSignIn?: (userId: string) => Promise<void>
  onSignInError?: (err: unknown) => void
  /** Issues the account's CLI key (in its workspace, created if needed). */
  issueCliKey?: (userId: string, headers: Headers) => Promise<LocalCliKey>
}

/** The part of Better Auth's internal adapter the local account needs. */
interface LocalUserStore {
  listUsers(limit?: number): Promise<User[]>
  createUser(
    user: { email: string; name: string; emailVerified: boolean },
    source: { method: string }
  ): Promise<User>
  findUserByEmail(email: string): Promise<{ user: User } | null>
}

/**
 * The instance's one account (created when there is none), or null when
 * there are several.
 */
async function resolveLocalUser(store: LocalUserStore): Promise<User | null> {
  const users = await store.listUsers(2)
  if (users.length > 1) return null
  const [existing] = users
  if (existing) return existing
  try {
    return await store.createUser(
      { email: LOCAL_USER_EMAIL, name: LOCAL_USER_NAME, emailVerified: true },
      { method: 'local-mode' }
    )
  } catch (err) {
    // Two first visits at once: the other one created it.
    const found = await store.findUserByEmail(LOCAL_USER_EMAIL)
    if (!found) throw err
    return found.user
  }
}

const SEVERAL_ACCOUNTS = {
  error: LOCAL_MODE_MULTIPLE_USERS,
  message: MULTIPLE_USERS_MESSAGE,
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
          const user = await resolveLocalUser(adapter)
          if (!user) {
            ctx.setStatus(409)
            return ctx.json(SEVERAL_ACCOUNTS)
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
      lumoLocalCliKey: createAuthEndpoint(
        LOCAL_CLI_KEY_ENDPOINT,
        { method: 'POST' },
        async ctx => {
          if (!opts.issueCliKey) throw new Error('no CLI key issuer configured')
          const user = await resolveLocalUser(ctx.context.internalAdapter)
          if (!user) {
            ctx.setStatus(409)
            return ctx.json(SEVERAL_ACCOUNTS)
          }
          const issued = await opts.issueCliKey(
            user.id,
            ctx.headers ?? new Headers()
          )
          ctx.setStatus(201)
          return ctx.json(issued)
        }
      ),
    },
  } satisfies BetterAuthPlugin
}
