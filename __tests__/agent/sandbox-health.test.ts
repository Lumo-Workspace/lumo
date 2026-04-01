import { isSandboxAlive } from '@/lib/agent/sandbox-health'

const mockConnect = jest.fn()

jest.mock('@e2b/code-interpreter', () => ({
  Sandbox: { connect: (...args: unknown[]) => mockConnect(...args) },
}))

describe('isSandboxAlive', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns true when sandbox connects successfully', async () => {
    mockConnect.mockResolvedValue({})
    const result = await isSandboxAlive('sandbox-123')
    expect(result).toBe(true)
    expect(mockConnect).toHaveBeenCalledWith('sandbox-123', { timeoutMs: 5000 })
  })

  it('returns false when sandbox connect throws', async () => {
    mockConnect.mockRejectedValue(new Error('not found'))
    const result = await isSandboxAlive('sandbox-dead')
    expect(result).toBe(false)
  })

  it('returns false for empty sandboxId', async () => {
    const result = await isSandboxAlive('')
    expect(result).toBe(false)
    expect(mockConnect).not.toHaveBeenCalled()
  })
})
