/** @jest-environment node */
import { cliCreateTaskSchema } from '@/lib/validation/schemas'

describe('cliCreateTaskSchema — rework/new-scope', () => {
  it('accepts reworkOfRef and newScope', () => {
    const parsed = cliCreateTaskSchema.parse({
      title: 'x',
      reworkOfRef: 'LUM-7',
      newScope: true,
    })
    expect(parsed.reworkOfRef).toBe('LUM-7')
    expect(parsed.newScope).toBe(true)
  })

  it('defaults newScope to false and leaves reworkOfRef undefined', () => {
    const parsed = cliCreateTaskSchema.parse({ title: 'x' })
    expect(parsed.newScope).toBe(false)
    expect(parsed.reworkOfRef).toBeUndefined()
  })
})
