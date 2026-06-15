/** @jest-environment node */
import { classifySilentFix } from '@/lib/boundary-crossing/silent-fix-judge'

const base = {
  filePath: 'app/widget.tsx',
  editSummary: 'changed color to #fff',
}

describe('classifySilentFix', () => {
  it('returns the judge verdict', async () => {
    await expect(
      classifySilentFix(base, { judge: async () => 'REAL_FIX' })
    ).resolves.toBe('REAL_FIX')
    await expect(
      classifySilentFix(base, { judge: async () => 'COSMETIC' })
    ).resolves.toBe('COSMETIC')
  })

  it('falls back to COSMETIC on judge error (never fabricate a hidden failure)', async () => {
    await expect(
      classifySilentFix(base, {
        judge: async () => {
          throw new Error('boom')
        },
      })
    ).resolves.toBe('COSMETIC')
  })

  it('falls back to COSMETIC on timeout', async () => {
    await expect(
      classifySilentFix(base, {
        timeoutMs: 5,
        judge: () =>
          new Promise(resolve => setTimeout(() => resolve('REAL_FIX'), 50)),
      })
    ).resolves.toBe('COSMETIC')
  })
})
