/** @jest-environment node */
import { classifySpinoff } from '@/lib/boundary-crossing/spinoff-judge'

const base = {
  parentCriteria: ['The widget renders in dark mode'],
  newTaskTitle: 'Fix widget dark-mode contrast',
  newTaskDescription: null,
}

describe('classifySpinoff', () => {
  it('returns the judge verdict when criteria exist', async () => {
    await expect(
      classifySpinoff(base, { judge: async () => 'LAUNDERED' })
    ).resolves.toBe('LAUNDERED')
    await expect(
      classifySpinoff(base, { judge: async () => 'LEGIT' })
    ).resolves.toBe('LEGIT')
  })

  it('is LEGIT (no judge call) when there are no parent criteria', async () => {
    const judge = jest.fn()
    await expect(
      classifySpinoff({ ...base, parentCriteria: [] }, { judge })
    ).resolves.toBe('LEGIT')
    expect(judge).not.toHaveBeenCalled()
  })

  it('falls back to LEGIT on judge error', async () => {
    await expect(
      classifySpinoff(base, {
        judge: async () => {
          throw new Error('boom')
        },
      })
    ).resolves.toBe('LEGIT')
  })

  it('falls back to LEGIT on timeout', async () => {
    await expect(
      classifySpinoff(base, {
        timeoutMs: 5,
        judge: () =>
          new Promise(resolve => setTimeout(() => resolve('LAUNDERED'), 50)),
      })
    ).resolves.toBe('LEGIT')
  })
})
