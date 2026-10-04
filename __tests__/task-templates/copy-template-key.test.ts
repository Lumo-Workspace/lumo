/**
 * LUM-972: copying a built-in into the workspace picks a key that avoids
 * built-in keys and the workspace's existing keys, and stays a valid slug.
 */
// Reserve an extra built-in key so the avoidance path is exercised.
jest.mock('@/lib/task-templates/system', () => ({
  isSystemTemplateKey: (key: string) =>
    ['agent-brief', 'reserved-copy'].includes(key),
}))

import { clampTemplateName, copyTemplateKey } from '@/lib/task-templates/copy'
import { taskTemplateKeySchema } from '@/lib/validation/task-template'

describe('copyTemplateKey', () => {
  it('uses <key>-copy when it is free', () => {
    expect(copyTemplateKey('agent-brief', ['agent-brief', 'bug-report'])).toBe(
      'agent-brief-copy'
    )
  })

  it('counts up -copy-2, -copy-3 past taken keys', () => {
    expect(
      copyTemplateKey('agent-brief', ['agent-brief', 'agent-brief-copy'])
    ).toBe('agent-brief-copy-2')
    expect(
      copyTemplateKey('agent-brief', ['agent-brief-copy', 'agent-brief-copy-2'])
    ).toBe('agent-brief-copy-3')
  })

  it('skips a key reserved by a built-in template', () => {
    expect(copyTemplateKey('reserved', [])).toBe('reserved-copy-2')
  })

  it('stays within the 40-char key cap and remains a valid slug', () => {
    const long = 'a-very-long-template-key-that-goes-on-and'
    const taken = new Set<string>()
    for (let i = 0; i < 12; i++) {
      const key = copyTemplateKey(long, taken)
      expect(key.length).toBeLessThanOrEqual(40)
      expect(taskTemplateKeySchema.safeParse(key).success).toBe(true)
      expect(taken.has(key)).toBe(false)
      taken.add(key)
    }
  })
})

describe('clampTemplateName', () => {
  it('keeps short names and cuts long ones to 80 chars', () => {
    expect(clampTemplateName('Agent brief (copy)')).toBe('Agent brief (copy)')
    expect(clampTemplateName('x'.repeat(90))).toHaveLength(80)
  })
})
