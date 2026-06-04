// __tests__/editor/slash-command.test.ts
import { getSlashCommandItems } from '@/lib/editor/slash-command'

describe('getSlashCommandItems', () => {
  // Identity translate fn → titles equal their message ids, easy to assert.
  const items = getSlashCommandItems((id: string) => id)

  it('includes a localized Callout item', () => {
    const callout = items.find(i => i.title === 'editor.slash.callout.title')
    expect(callout).toBeDefined()
    expect(callout?.description).toBe('editor.slash.callout.description')
    expect(typeof callout?.command).toBe('function')
  })

  it('includes a localized Toggle item', () => {
    const toggle = items.find(i => i.title === 'editor.slash.toggle.title')
    expect(toggle).toBeDefined()
    expect(toggle?.description).toBe('editor.slash.toggle.description')
    expect(typeof toggle?.command).toBe('function')
  })

  it('still returns the existing built-in items', () => {
    expect(items.find(i => i.title === 'Text')).toBeDefined()
    expect(items.find(i => i.title === 'Table')).toBeDefined()
  })

  it('works with no translate fn (English fallback for new items)', () => {
    const fallback = getSlashCommandItems()
    expect(fallback.find(i => i.title === 'Callout')).toBeDefined()
    expect(fallback.find(i => i.title === 'Toggle')).toBeDefined()
  })
})
