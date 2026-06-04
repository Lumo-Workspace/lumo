import { SYSTEM_TEMPLATES } from '@/lib/editor/templates'

describe('SYSTEM_TEMPLATES', () => {
  it('ships exactly the four v1 templates with unique keys', () => {
    const keys = SYSTEM_TEMPLATES.map(t => t.key)
    expect(keys).toEqual(['prd', 'rfc', 'meeting-notes', 'weekly-report'])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every template has non-empty HTML content and an emoji', () => {
    for (const t of SYSTEM_TEMPLATES) {
      expect(t.content.length).toBeGreaterThan(0)
      expect(t.content).toContain('<h1>')
      expect(typeof t.emoji).toBe('string')
      expect(t.emoji.length).toBeGreaterThan(0)
    }
  })

  it('meeting-notes carries an extractable Action Items task-list', () => {
    const meeting = SYSTEM_TEMPLATES.find(t => t.key === 'meeting-notes')
    expect(meeting).toBeDefined()
    expect(meeting!.content).toContain('data-type="taskList"')
    expect(meeting!.content).toContain('data-type="taskItem"')
    expect(meeting!.content).toContain('data-checked="false"')
  })

  it('assigns ascending sortOrder', () => {
    const orders = SYSTEM_TEMPLATES.map(t => t.sortOrder)
    const sorted = [...orders].sort((a, b) => a - b)
    expect(orders).toEqual(sorted)
  })
})
