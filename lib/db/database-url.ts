/**
 * Which Postgres connection string the app connects with.
 *
 * On a Vercel production deployment the Neon integration owns
 * `PROD_DATABASE_URL` (pooled) and `PROD_DATABASE_URL_UNPOOLED` (direct) and
 * rewrites them whenever the database password rotates, so production reads
 * those first. A rotation then needs no hand-copied `DATABASE_URL`.
 *
 * Everywhere else (preview, development, local scripts, tests) only
 * `DATABASE_URL` / `DATABASE_URL_UNPOOLED` are read, even when PROD_* happen to
 * be set, so nothing outside a production deployment reaches the production
 * database by accident. The production branch is keyed on `VERCEL_ENV`, never
 * on the mere presence of PROD_*.
 *
 * If PROD_* are empty on production (e.g. a locally pulled env file, where
 * sensitive values come back blank), this falls back to the plain variables,
 * which is exactly the behaviour before PROD_* were read.
 *
 * No `@/` imports: prisma.config.ts loads this file outside the Next.js build.
 */

type Env = Record<string, string | undefined>

/** `pooled` serves queries; `direct` runs migrations (DDL needs no pooler). */
export type DatabaseUrlKind = 'pooled' | 'direct'

export function resolveDatabaseUrl(
  kind: DatabaseUrlKind,
  env: Env = process.env
): string | undefined {
  if (env.VERCEL_ENV === 'production') {
    const managed =
      kind === 'pooled' ? env.PROD_DATABASE_URL : env.PROD_DATABASE_URL_UNPOOLED
    if (managed) return managed
  }
  return kind === 'pooled'
    ? env.DATABASE_URL
    : env.DATABASE_URL_UNPOOLED || env.DATABASE_URL
}
