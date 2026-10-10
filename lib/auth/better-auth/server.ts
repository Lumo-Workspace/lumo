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
 * `next build` and Clerk deployments do not need BETTER_AUTH_SECRET.
 */
import { betterAuth } from 'better-auth'
import { createAuthEndpoint } from 'better-auth/api'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import type { BetterAuthPlugin } from 'better-auth'
import { prisma } from '@/lib/db/prisma'
import { authUserRepository } from '@/lib/repositories/auth-user.repository'
import { logger } from '@/lib/logger'
import { sendEmail } from '@/lib/integrations/email/client'
import {
  BETTER_AUTH_BASE_PATH,
  isSignUpDisabled,
  resolveBetterAuthBaseUrl,
  resolveBetterAuthSecret,
  resolvePublicAuthConfig,
  resolveSocialProviders,
} from './config'
import { nameFieldsForCreate, nameFieldsForUpdate } from './user-shape'
import { resolveMcpOAuthUrls } from './mcp-oauth-config'
import { MCP_OAUTH_DISABLED_PATHS, mcpOAuthPlugins } from './mcp-oauth-plugins'
import { buildVerifyEmail } from '@/lib/integrations/email/templates/verify-email'
import { verifyPasswordHash } from './password'
import {
  RESET_PASSWORD_TOKEN_TTL_SECONDS,
  sendResetPasswordEmail,
} from './password-reset'
import { generateAuthId } from './ids'
import { RATE_LIMIT_OPTIONS } from './rate-limit'
import { ACCOUNT_LINKING_OPTIONS } from './account-linking'

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

function createBetterAuth() {
  // MCP OAuth (LUM-1044) needs a fixed public URL for its issuer and token
  // audience; without BETTER_AUTH_URL / NEXT_PUBLIC_APP_URL it stays off.
  const mcpOAuthUrls = resolveMcpOAuthUrls()
  return betterAuth({
    secret: resolveBetterAuthSecret(),
    baseURL: resolveBetterAuthBaseUrl(),
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
      enabled: true,
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
    advanced: { database: { generateId: generateAuthId } },
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
    disabledPaths: mcpOAuthUrls ? MCP_OAUTH_DISABLED_PATHS : [],
    plugins: [
      lumoPublicConfigPlugin,
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
