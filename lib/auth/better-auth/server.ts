/**
 * LUM-1027 — the Better Auth server instance (self-hosted auth provider).
 *
 * Identity mapping: a Better Auth user id is an opaque string, exactly like a
 * Clerk user id, and is stored in the same identity columns
 * (WorkspaceMember.clerkId, McpConnection.clerkUserId, …). Lumo keeps no user
 * table of its own — memberships are created when a workspace is created or
 * an invite is accepted — so the database hooks below only keep the
 * first/last-name columns of `auth_users` in step with Better Auth's `name`.
 *
 * Built lazily on first use: importing this module never reads env, so
 * `next build` does not need BETTER_AUTH_SECRET.
 */
import { betterAuth } from 'better-auth'
import { createAuthEndpoint } from 'better-auth/api'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import { emailOTP } from 'better-auth/plugins/email-otp'
import type { BetterAuthPlugin } from 'better-auth'
import { prisma } from '@/lib/db/prisma'
import { authUserRepository } from '@/lib/repositories/auth-user.repository'
import { logger } from '@/lib/logger'
import { sendEmail } from '@/lib/integrations/email/client'
import {
  BETTER_AUTH_BASE_PATH,
  googleSignInSharesDriveClient,
  isEmailCodeSignInEnabled,
  isPasswordSignInEnabled,
  isSignUpDisabled,
  resolveBetterAuthBaseUrl,
  resolveBetterAuthSecret,
  resolvePublicAuthConfig,
  resolveSocialProviders,
} from './config'
import { nameFieldsForCreate, nameFieldsForUpdate } from './user-shape'
import { resolveMcpOAuthUrls } from './mcp-oauth-config'
import { MCP_OAUTH_DISABLED_PATHS, mcpOAuthPlugins } from './mcp-oauth-plugins'
import { ADMIN_DISABLED_PATHS, lumoAdminPlugin } from './admin-plugin'
import { buildVerifyEmail } from '@/lib/integrations/email/templates/verify-email'
import { verifyPasswordHash } from './password'
import {
  RESET_PASSWORD_TOKEN_TTL_SECONDS,
  sendResetPasswordEmail,
} from './password-reset'
import { generateAuthId } from './ids'
import { RATE_LIMIT_OPTIONS } from './rate-limit'
import { ACCOUNT_LINKING_OPTIONS } from './account-linking'
import { waitUntil } from '@/lib/runtime/wait-until'
import {
  EMAIL_OTP_DISABLED_PATHS,
  emailOtpOptions,
  lumoEmailOtpGuardPlugin,
} from './email-otp'
import { isLocalMode, isLocalModeOnPublicUrl } from '../local-mode'
import { lumoLocalModePlugin } from './local-mode'

/** Session cookie cache: page loads skip the DB for this many seconds. */
export const SESSION_COOKIE_CACHE_SECONDS = 5 * 60

/**
 * GET {basePath}/lumo/config — the public sign-in options of this instance
 * (which OAuth buttons to show, whether sign-up is open). Served at runtime so
 * a prebuilt image picks up its env without a rebuild.
 */
const lumoPublicConfigPlugin = {
  id: 'lumo-public-config',
  endpoints: {
    lumoPublicConfig: createAuthEndpoint(
      '/lumo/config',
      { method: 'GET' },
      async ctx => ctx.json(resolvePublicAuthConfig())
    ),
  },
} satisfies BetterAuthPlugin

/**
 * LUM-1082 — password endpoints that stay reachable when `emailAndPassword`
 * is off (Better Auth only refuses sign-in and sign-up then): with password
 * sign-in disabled nobody may set or reset a password either.
 */
export const PASSWORD_DISABLED_PATHS = [
  '/request-password-reset',
  '/reset-password',
  '/change-password',
] as const

/** LUM-1082: configuration mistakes worth a log line at start-up. */
function warnAboutSignInConfig(opts: {
  passwordEnabled: boolean
  emailCodeEnabled: boolean
  baseUrl: string | undefined
}): void {
  // LUM-1335: the operator's choice, but never a quiet one.
  if (isLocalModeOnPublicUrl(opts.baseUrl)) {
    logger.warn(
      `[auth] LUMO_MODE=local on ${opts.baseUrl}: anyone who can open this URL is signed in ` +
        'without a password. Remove LUMO_MODE from .env unless only you can reach it.'
    )
  }
  if (googleSignInSharesDriveClient()) {
    logger.warn(
      '[auth] AUTH_GOOGLE_CLIENT_ID is the Google Drive import client (GOOGLE_CLIENT_ID): ' +
        "Google's sign-in screen will also list the Drive access granted to that client. " +
        'Use a separate OAuth client for sign-in.'
    )
  }
  if (!opts.passwordEnabled && !opts.emailCodeEnabled) {
    logger.warn(
      '[auth] AUTH_DISABLE_PASSWORD is set and no email transport is configured: ' +
        'only GitHub / Google sign-in is available'
    )
  }
}

function createBetterAuth() {
  // MCP OAuth (LUM-1044) needs a fixed public URL for its issuer and token
  // audience; without BETTER_AUTH_URL / NEXT_PUBLIC_APP_URL it stays off.
  const mcpOAuthUrls = resolveMcpOAuthUrls()
  // LUM-1082: email-first sign-in. Password sign-in is a switch (the hosted
  // SaaS turns it off); the email code needs a way to deliver it.
  const passwordEnabled = isPasswordSignInEnabled()
  const emailCodeEnabled = isEmailCodeSignInEnabled()
  const baseUrl = resolveBetterAuthBaseUrl()
  // LUM-1335: also rejects an unknown LUMO_MODE before anyone signs in.
  const localMode = isLocalMode()
  warnAboutSignInConfig({ passwordEnabled, emailCodeEnabled, baseUrl })
  return betterAuth({
    secret: resolveBetterAuthSecret(),
    baseURL: baseUrl,
    basePath: BETTER_AUTH_BASE_PATH,
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    telemetry: { enabled: false },
    // Prisma model names (prisma/schema.prisma, LUM-1027): `Session` and
    // friends are already Lumo's own models.
    user: {
      modelName: 'authUser',
      additionalFields: {
        firstName: { type: 'string', required: false, input: false },
        lastName: { type: 'string', required: false, input: false },
      },
    },
    session: {
      modelName: 'authSession',
      cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_SECONDS },
    },
    // LUM-1070: explicit linking policy — no trusted providers (./account-linking).
    account: {
      modelName: 'authAccount',
      accountLinking: ACCOUNT_LINKING_OPTIONS,
    },
    verification: { modelName: 'authVerification' },
    emailAndPassword: {
      enabled: passwordEnabled,
      disableSignUp: isSignUpDisabled(),
      // Sign-in works before verification (a fresh instance may have no SMTP
      // yet); only VERIFIED addresses can match a workspace invite
      // (getVerifiedEmails), so an unverified one grants nothing.
      requireEmailVerification: false,
      // LUM-1070: bcrypt hashes imported from Clerk verify too; new hashes
      // stay Better Auth's scrypt (./password).
      password: { verify: verifyPasswordHash },
      // LUM-1070: forgot / reset password (./password-reset). A reset signs
      // the account out everywhere.
      sendResetPassword: sendResetPasswordEmail,
      resetPasswordTokenExpiresIn: RESET_PASSWORD_TOKEN_TTL_SECONDS,
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const { subject, html, text } = buildVerifyEmail(url)
        const result = await sendEmail({
          to: [user.email],
          subject,
          html,
          text,
        })
        if (result.status !== 'sent') {
          logger.warn('[auth] verification email not sent', {
            status: result.status,
          })
        }
      },
    },
    socialProviders: resolveSocialProviders(),
    // LUM-1070: counters shared by every instance (./rate-limit).
    rateLimit: RATE_LIMIT_OPTIONS,
    // LUM-1070: new users get `user_…` ids, the shape of a Clerk id (./ids).
    advanced: {
      database: { generateId: generateAuthId },
      // LUM-1070: emails (password reset, verification) are sent after the
      // response, so a reset request for a real account answers as fast as
      // one for an unknown address (no account enumeration by timing).
      backgroundTasks: { handler: waitUntil },
    },
    databaseHooks: {
      user: {
        create: {
          before: async user => ({
            data: { ...user, ...nameFieldsForCreate(user) },
          }),
        },
        update: {
          before: async (update, ctx) => {
            if (update.name === undefined) return
            const id = ctx?.context.session?.user.id
            const current = id ? await authUserRepository.findById(id) : null
            const base = {
              name: current?.name ?? update.name,
              firstName: current?.firstName ?? null,
              lastName: current?.lastName ?? null,
            }
            return {
              data: {
                ...update,
                ...nameFieldsForUpdate(base, { name: update.name }),
              },
            }
          },
        },
      },
    },
    disabledPaths: [
      ...(mcpOAuthUrls ? MCP_OAUTH_DISABLED_PATHS : []),
      // LUM-1071: impersonation is closed.
      ...ADMIN_DISABLED_PATHS,
      ...(passwordEnabled ? [] : PASSWORD_DISABLED_PATHS),
      ...(emailCodeEnabled ? EMAIL_OTP_DISABLED_PATHS : []),
    ],
    plugins: [
      lumoPublicConfigPlugin,
      // LUM-1071: ban fields + the sign-in ban check (./admin-plugin).
      lumoAdminPlugin(),
      // LUM-1335: sign-in-free try-outs (./local-mode).
      ...(localMode
        ? [
            lumoLocalModePlugin({
              // Imported lazily: the service graph is not needed to sign in.
              onSignIn: async userId => {
                const { localModeService } =
                  await import('@/lib/services/local-mode.service')
                await localModeService.ensureWorkspace(userId)
              },
              onSignInError: err =>
                logger.warn('[auth] local mode: could not set up a workspace', {
                  error: err instanceof Error ? err.message : String(err),
                }),
              issueCliKey: async (userId, headers) => {
                const [{ localModeService }, { memberAuditContext }] =
                  await Promise.all([
                    import('@/lib/services/local-mode.service'),
                    import('@/lib/api/audit-context'),
                  ])
                return localModeService.issueCliKey(
                  userId,
                  memberAuditContext(headers, { clerkId: userId }, 'bearer')
                )
              },
            }),
          ]
        : []),
      // LUM-1082: email one-time-code sign-in (./email-otp).
      ...(emailCodeEnabled
        ? [
            lumoEmailOtpGuardPlugin(),
            emailOTP(emailOtpOptions({ disableSignUp: isSignUpDisabled() })),
          ]
        : []),
      ...(mcpOAuthUrls ? mcpOAuthPlugins(mcpOAuthUrls) : []),
      // Must stay last: sets cookies from server actions.
      nextCookies(),
    ],
  })
}

export type LumoBetterAuth = ReturnType<typeof createBetterAuth>

declare global {
  var lumoBetterAuth: LumoBetterAuth | undefined
}

/** The process-wide Better Auth instance (created on first call). */
export function getBetterAuth(): LumoBetterAuth {
  globalThis.lumoBetterAuth ??= createBetterAuth()
  return globalThis.lumoBetterAuth
}
