/**
 * @jest-environment node
 *
 * LUM-1030 — Workflow World selection for self-hosting, the direct-URL
 * (pooler) warning of ruling ②, and the boot hook that starts the Postgres
 * World only when it is selected (the Vercel path stays untouched).
 */
jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

import { logger } from '@/lib/logger'
import {
  checkPostgresWorldConfig,
  looksLikePoolerUrl,
  redactConnectionUrl,
  resolveWorkflowWorld,
} from '@/lib/runtime/workflow-world'
import { startSelfHostedWorkflowWorld } from '@/lib/runtime/workflow-world-start'

const env = (vars: Record<string, string | undefined>) =>
  vars as unknown as NodeJS.ProcessEnv

const DIRECT = 'postgres://lumo:pw@db.internal:5432/lumo'
const GOOD = {
  WORKFLOW_TARGET_WORLD: '@workflow/world-postgres',
  WORKFLOW_POSTGRES_URL: DIRECT,
  WORKFLOW_SECRET: 's3cret',
  WORKFLOW_LOCAL_BASE_URL: 'http://workflow:s3cret@localhost:3000',
  PORT: '3000',
}

beforeEach(() => jest.clearAllMocks())

describe('resolveWorkflowWorld', () => {
  it('LUM-1030 world selection: WORKFLOW_TARGET_WORLD=@workflow/world-postgres selects the Postgres World', () => {
    expect(resolveWorkflowWorld(env(GOOD))).toBe('postgres')
  })

  it('LUM-1030 world selection: a Vercel deployment without an override stays on the Vercel World', () => {
    expect(resolveWorkflowWorld(env({ VERCEL_DEPLOYMENT_ID: 'dpl_1' }))).toBe(
      'vercel'
    )
    expect(
      resolveWorkflowWorld(
        env({ WORKFLOW_TARGET_WORLD: '@workflow/world-vercel' })
      )
    ).toBe('vercel')
  })

  it('LUM-1030 world selection: no target and no deployment id is the Local World; anything else is "other"', () => {
    expect(resolveWorkflowWorld(env({}))).toBe('local')
    expect(resolveWorkflowWorld(env({ WORKFLOW_TARGET_WORLD: 'local' }))).toBe(
      'local'
    )
    expect(
      resolveWorkflowWorld(env({ WORKFLOW_TARGET_WORLD: '@acme/world-redis' }))
    ).toBe('other')
  })

  it('LUM-1030 world selection: an explicit target wins over the Vercel deployment id', () => {
    expect(
      resolveWorkflowWorld(env({ ...GOOD, VERCEL_DEPLOYMENT_ID: 'dpl_1' }))
    ).toBe('postgres')
  })
})

describe('looksLikePoolerUrl (ruling ②)', () => {
  it.each([
    'postgresql://u:p@ep-cool-123-pooler.us-east-2.aws.neon.tech/db?sslmode=require',
    'postgres://u:p@aws-0-eu.pooler.supabase.com:5432/postgres',
    'postgres://u:p@pgbouncer.internal:6432/lumo',
    'postgres://u:p@db.internal:5432/lumo?pgbouncer=true',
  ])('LUM-1030 pooler: %s is flagged', url => {
    expect(looksLikePoolerUrl(url)).toBe(true)
  })

  it.each([
    DIRECT,
    'postgresql://u:p@ep-cool-123.us-east-2.aws.neon.tech/db?sslmode=require',
    'postgres://u:p@localhost:55432/lumo',
    'not a url',
  ])('LUM-1030 pooler: %s is not flagged', url => {
    expect(looksLikePoolerUrl(url)).toBe(false)
  })
})

describe('checkPostgresWorldConfig', () => {
  it('LUM-1030 config: a complete direct setup has no errors and no warnings', () => {
    expect(checkPostgresWorldConfig(env(GOOD))).toEqual({
      errors: [],
      warnings: [],
    })
  })

  it('LUM-1030 config: a missing WORKFLOW_POSTGRES_URL is an error (no silent localhost fallback)', () => {
    const { errors } = checkPostgresWorldConfig(
      env({ ...GOOD, WORKFLOW_POSTGRES_URL: undefined })
    )
    expect(errors).toEqual([expect.stringMatching(/WORKFLOW_POSTGRES_URL/)])
  })

  it('LUM-1030 config: a pooler URL warns, with the password redacted', () => {
    const { errors, warnings } = checkPostgresWorldConfig(
      env({
        ...GOOD,
        WORKFLOW_POSTGRES_URL:
          'postgresql://lumo:hunter2@ep-x-pooler.eu-central-1.aws.neon.tech/lumo',
      })
    )
    expect(errors).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/pooler/)
    expect(warnings[0]).toMatch(/direct/)
    expect(warnings[0]).not.toContain('hunter2')
    expect(warnings[0]).toContain('postgresql://[redacted]@ep-x-pooler')
  })

  it('LUM-1030 config: a delivery URL without the secret, or no secret at all, warns (deliveries would get 401)', () => {
    expect(
      checkPostgresWorldConfig(
        env({ ...GOOD, WORKFLOW_LOCAL_BASE_URL: 'http://localhost:3000' })
      ).warnings
    ).toEqual([expect.stringMatching(/carries no credentials/)])
    expect(
      checkPostgresWorldConfig(env({ ...GOOD, WORKFLOW_SECRET: undefined }))
        .warnings
    ).toEqual([expect.stringMatching(/WORKFLOW_SECRET is not set/)])
    expect(
      checkPostgresWorldConfig(
        env({ ...GOOD, WORKFLOW_LOCAL_BASE_URL: undefined })
      ).warnings
    ).toEqual([expect.stringMatching(/WORKFLOW_LOCAL_BASE_URL is not set/)])
  })

  it('LUM-1030 config: a delivery port that differs from PORT warns', () => {
    expect(
      checkPostgresWorldConfig(env({ ...GOOD, PORT: '3999' })).warnings
    ).toEqual([expect.stringMatching(/differs from PORT 3999/)])
  })
})

describe('redactConnectionUrl', () => {
  it('LUM-1030 redact: drops user:password', () => {
    expect(redactConnectionUrl('postgres://u:p@h:5432/d')).toBe(
      'postgres://[redacted]@h:5432/d'
    )
    expect(
      redactConnectionUrl('connect failed for postgres://u:p@h/d (timeout)')
    ).toBe('connect failed for postgres://[redacted]@h/d (timeout)')
  })
})

describe('startSelfHostedWorkflowWorld', () => {
  it('LUM-1030 boot: starts the world when the Postgres World is selected', async () => {
    const start = jest.fn(async () => undefined)
    const getWorld = jest.fn(() => ({ start }))

    await expect(
      startSelfHostedWorkflowWorld(env(GOOD), { getWorld })
    ).resolves.toBe(true)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('LUM-1030 boot: on Vercel (or the Local World) it never touches the world', async () => {
    const getWorld = jest.fn()
    await expect(
      startSelfHostedWorkflowWorld(env({ VERCEL_DEPLOYMENT_ID: 'dpl_1' }), {
        getWorld,
      })
    ).resolves.toBe(false)
    await expect(
      startSelfHostedWorkflowWorld(env({}), { getWorld })
    ).resolves.toBe(false)
    expect(getWorld).not.toHaveBeenCalled()
  })

  it('LUM-1030 boot: logs the pooler warning at startup and still starts', async () => {
    const start = jest.fn(async () => undefined)
    await startSelfHostedWorkflowWorld(
      env({
        ...GOOD,
        WORKFLOW_POSTGRES_URL: 'postgres://u:p@x-pooler.neon.tech/db',
      }),
      { getWorld: () => ({ start }) }
    )
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/pooler/))
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('LUM-1030 boot: refuses to start without WORKFLOW_POSTGRES_URL', async () => {
    const getWorld = jest.fn()
    await expect(
      startSelfHostedWorkflowWorld(
        env({ ...GOOD, WORKFLOW_POSTGRES_URL: undefined }),
        { getWorld }
      )
    ).rejects.toThrow(/WORKFLOW_POSTGRES_URL/)
    expect(getWorld).not.toHaveBeenCalled()
  })
})

describe('instrumentation.ts', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('LUM-1030 boot: register() is a no-op on the edge runtime and when no Postgres World is selected', async () => {
    const { register } = await import('../../../instrumentation')
    process.env = { ...saved, NEXT_RUNTIME: 'edge', ...GOOD }
    await expect(register()).resolves.toBeUndefined()
    process.env = { ...saved, NEXT_RUNTIME: 'nodejs' }
    delete process.env.WORKFLOW_TARGET_WORLD
    await expect(register()).resolves.toBeUndefined()
    expect(logger.info).not.toHaveBeenCalled()
  })
})
