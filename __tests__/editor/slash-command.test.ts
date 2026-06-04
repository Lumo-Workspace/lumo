// __tests__/editor/slash-command.test.ts
import { getSlashCommandItems } from '@/lib/editor/slash-command'

describe('getSlashCommandItems', () => {
  describe('with identity translate fn (message ids as values)', () => {
    const items = getSlashCommandItems((id: string) => id)

    it('built-in text item has message-id title', () => {
      const text = items.find(i => i.title === 'editor.slash.text.title')
      expect(text).toBeDefined()
      expect(text?.description).toBe('editor.slash.text.description')
      expect(typeof text?.command).toBe('function')
    })

    it('built-in table item has message-id title', () => {
      const table = items.find(i => i.title === 'editor.slash.table.title')
      expect(table).toBeDefined()
      expect(table?.description).toBe('editor.slash.table.description')
      expect(typeof table?.command).toBe('function')
    })

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

    it('items carry correct categoryKey values', () => {
      const text = items.find(i => i.title === 'editor.slash.text.title')
      expect(text?.categoryKey).toBe('basic')

      const image = items.find(i => i.title === 'editor.slash.image.title')
      expect(image?.categoryKey).toBe('media')

      const table = items.find(i => i.title === 'editor.slash.table.title')
      expect(table?.categoryKey).toBe('advanced')

      const callout = items.find(i => i.title === 'editor.slash.callout.title')
      expect(callout?.categoryKey).toBe('advanced')

      const toggle = items.find(i => i.title === 'editor.slash.toggle.title')
      expect(toggle?.categoryKey).toBe('advanced')
    })

    it('all items have a categoryKey', () => {
      for (const item of items) {
        expect(typeof item.categoryKey).toBe('string')
        expect(item.categoryKey.length).toBeGreaterThan(0)
      }
    })

    it('category display label uses message id via t fn', () => {
      const text = items.find(i => i.title === 'editor.slash.text.title')
      expect(text?.category).toBe('editor.slash.category.basic')

      const image = items.find(i => i.title === 'editor.slash.image.title')
      expect(image?.category).toBe('editor.slash.category.media')

      const table = items.find(i => i.title === 'editor.slash.table.title')
      expect(table?.category).toBe('editor.slash.category.advanced')
    })
  })

  describe('with no translate fn (English fallback)', () => {
    const fallback = getSlashCommandItems()

    it('built-in text item uses English fallback', () => {
      expect(fallback.find(i => i.title === 'Text')).toBeDefined()
    })

    it('built-in table item uses English fallback', () => {
      expect(fallback.find(i => i.title === 'Table')).toBeDefined()
    })

    it('Callout uses English fallback', () => {
      expect(fallback.find(i => i.title === 'Callout')).toBeDefined()
    })

    it('Toggle uses English fallback', () => {
      expect(fallback.find(i => i.title === 'Toggle')).toBeDefined()
    })

    it('categories use English fallback', () => {
      const text = fallback.find(i => i.title === 'Text')
      expect(text?.category).toBe('Basic')

      const image = fallback.find(i => i.title === 'Image')
      expect(image?.category).toBe('Media')

      const table = fallback.find(i => i.title === 'Table')
      expect(table?.category).toBe('Advanced')
    })
  })
})
