import { resolveDatabaseUrl } from '@/lib/db/database-url'

// Placeholder connection strings: hosts and roles only, no credentials.
const env = {
  DATABASE_URL: 'postgres://app@legacy-pooler.example/db',
  DATABASE_URL_UNPOOLED: 'postgres://app@legacy.example/db',
  PROD_DATABASE_URL: 'postgres://app@managed-pooler.example/db',
  PROD_DATABASE_URL_UNPOOLED: 'postgres://app@managed.example/db',
}

describe('resolveDatabaseUrl', () => {
  it('reads the Neon-managed PROD vars on a production deployment', () => {
    const prod = { ...env, VERCEL_ENV: 'production' }
    expect(resolveDatabaseUrl('pooled', prod)).toBe(env.PROD_DATABASE_URL)
    expect(resolveDatabaseUrl('direct', prod)).toBe(
      env.PROD_DATABASE_URL_UNPOOLED
    )
  })

  it('never reads PROD vars outside production even when they are set', () => {
    for (const VERCEL_ENV of ['preview', 'development', undefined]) {
      const other = { ...env, VERCEL_ENV }
      expect(resolveDatabaseUrl('pooled', other)).toBe(env.DATABASE_URL)
      expect(resolveDatabaseUrl('direct', other)).toBe(
        env.DATABASE_URL_UNPOOLED
      )
    }
  })

  it('falls back to the plain vars on production when PROD vars are empty', () => {
    const pulled = {
      ...env,
      VERCEL_ENV: 'production',
      PROD_DATABASE_URL: '',
      PROD_DATABASE_URL_UNPOOLED: undefined,
    }
    expect(resolveDatabaseUrl('pooled', pulled)).toBe(env.DATABASE_URL)
    expect(resolveDatabaseUrl('direct', pulled)).toBe(env.DATABASE_URL_UNPOOLED)
  })

  it('uses DATABASE_URL for migrations when no unpooled URL is set', () => {
    const local = { DATABASE_URL: env.DATABASE_URL }
    expect(resolveDatabaseUrl('direct', local)).toBe(env.DATABASE_URL)
  })

  it('never hands the pooled PROD URL to migrations', () => {
    const prodPooledOnly = {
      VERCEL_ENV: 'production',
      PROD_DATABASE_URL: env.PROD_DATABASE_URL,
      DATABASE_URL_UNPOOLED: env.DATABASE_URL_UNPOOLED,
    }
    expect(resolveDatabaseUrl('direct', prodPooledOnly)).toBe(
      env.DATABASE_URL_UNPOOLED
    )
  })
})
