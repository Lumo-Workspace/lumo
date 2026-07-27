import { checkRateLimit, BOOTSTRAP_TOOLS } from '@/lib/mcp/rate-limit'

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

beforeEach(() => jest.clearAllMocks())

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
