import {
  checkRateLimit,
  BOOTSTRAP_TOOLS,
  __resetMcpRateLimitForTests,
} from '@/lib/mcp/rate-limit'

const mockLimit = jest.fn()
jest.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    limit(...args: any[]) {
      return mockLimit(...args)
    }
    static slidingWindow(): null {
      return null
    }
  },
}))
jest.mock('@vercel/kv', () => ({ kv: {} }))

const ORIGINAL_ENV = process.env

function setEnv(vars: Record<string, string>): void {
  process.env = { ...ORIGINAL_ENV }
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  delete process.env.REDIS_URL
  Object.assign(process.env, vars)
}

beforeEach(() => {
  jest.clearAllMocks()
  __resetMcpRateLimitForTests()
  // Vercel KV configured — the hosted SaaS path (LUM-1020: backend is env-selected).
  setEnv({
    KV_REST_API_URL: 'https://example-kv.upstash.io',
    KV_REST_API_TOKEN: 'test-token',
  })
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('checkRateLimit', () => {
  it('skips bootstrap tools', async () => {
    const result = await checkRateLimit({
      clerkUserId: 'u1',
      toolName: 'select_workspace',
    })
    expect(result.success).toBe(true)
    expect(mockLimit).not.toHaveBeenCalled()
  })

  it('throws RATE_LIMIT when exceeded', async () => {
    mockLimit.mockResolvedValue({ success: false, reset: Date.now() + 1000 })
    await expect(
      checkRateLimit({ clerkUserId: 'u1', toolName: 'list_tasks' })
    ).rejects.toMatchObject({ code: 'RATE_LIMIT' })
  })

  it('passes through when allowed', async () => {
    mockLimit.mockResolvedValue({ success: true })
    const result = await checkRateLimit({
      clerkUserId: 'u1',
      toolName: 'list_tasks',
    })
    expect(result.success).toBe(true)
    expect(mockLimit).toHaveBeenCalledWith('u1')
  })

  it('BOOTSTRAP_TOOLS contains exactly the 3 bootstrap tools', () => {
    expect(BOOTSTRAP_TOOLS).toEqual(
      new Set([
        'list_my_workspaces',
        'select_workspace',
        'get_active_workspace',
      ])
    )
  })
})

describe('checkRateLimit — nothing configured (in-memory fallback, LUM-1020)', () => {
  beforeEach(() => setEnv({}))

  it('allows 60 calls per user per minute, then throws RATE_LIMIT, without touching Upstash', async () => {
    for (let i = 0; i < 60; i++) {
      await checkRateLimit({ clerkUserId: 'u-mem', toolName: 'list_tasks' })
    }
    await expect(
      checkRateLimit({ clerkUserId: 'u-mem', toolName: 'list_tasks' })
    ).rejects.toMatchObject({ code: 'RATE_LIMIT' })
    await expect(
      checkRateLimit({ clerkUserId: 'u-other', toolName: 'list_tasks' })
    ).resolves.toMatchObject({ success: true, remaining: 59 })
    expect(mockLimit).not.toHaveBeenCalled()
  })
})
