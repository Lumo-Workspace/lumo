import { updateWorkspaceSchema } from '@/lib/validation/schemas'
import { workspaceService } from '@/lib/services/workspace.service'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'

jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    update: jest.fn(),
    isSlugUnique: jest.fn(),
  },
}))

const update = workspaceRepository.update as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  update.mockResolvedValue({ id: 'w-1', verificationMaxRounds: 5 })
})

// LUM-429: the machine-verification round cap is a per-workspace OWNER setting
// mirroring the existing risk* numeric settings.
describe('verificationMaxRounds settings write', () => {
  describe('updateWorkspaceSchema validation (1..10 integers only)', () => {
    it.each([1, 3, 5, 10])('accepts the in-range integer %d', n => {
      const parsed = updateWorkspaceSchema.safeParse({
        verificationMaxRounds: n,
      })
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.verificationMaxRounds).toBe(n)
      }
    })

    it.each([0, 11, -1, 100])('rejects the out-of-range value %d', n => {
      const parsed = updateWorkspaceSchema.safeParse({
        verificationMaxRounds: n,
      })
      expect(parsed.success).toBe(false)
    })

    it('rejects a non-integer value', () => {
      expect(
        updateWorkspaceSchema.safeParse({ verificationMaxRounds: 2.5 }).success
      ).toBe(false)
    })

    it('is optional — a body without it still parses', () => {
      const parsed = updateWorkspaceSchema.safeParse({ name: 'Acme' })
      expect(parsed.success).toBe(true)
    })
  })

  describe('updateWorkspace persistence (OWNER-gated)', () => {
    it('persists verificationMaxRounds for an OWNER', async () => {
      await workspaceService.updateWorkspace('w-1', 'OWNER', 'acme', {
        verificationMaxRounds: 5,
      })
      expect(update).toHaveBeenCalledTimes(1)
      expect(update).toHaveBeenCalledWith('w-1', { verificationMaxRounds: 5 })
    })

    it('refuses a non-OWNER with 403 before any write', async () => {
      await expect(
        workspaceService.updateWorkspace('w-1', 'MEMBER', 'acme', {
          verificationMaxRounds: 5,
        })
      ).rejects.toMatchObject({ status: 403 })
      expect(update).not.toHaveBeenCalled()
    })

    it('omits the field from the persisted patch when not provided', async () => {
      await workspaceService.updateWorkspace('w-1', 'OWNER', 'acme', {
        name: 'Acme',
      })
      const patch = update.mock.calls[0]![1]
      expect(patch).not.toHaveProperty('verificationMaxRounds')
    })
  })
})
