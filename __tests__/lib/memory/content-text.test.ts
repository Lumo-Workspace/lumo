import { memoryContentToText } from '@/lib/memory/content-text'

describe('memoryContentToText', () => {
  it('flattens a TRAP in field order, skipping absent optionals', () => {
    const text = memoryContentToText('TRAP', {
      summary: 'enum trap',
      trigger: 'add enum value and use it same migration',
      outcome: 'P3009',
    })
    expect(text).toBe('enum trap add enum value and use it same migration P3009')
  })

  it('flattens DECISION fields including alternatives/implications', () => {
    const text = memoryContentToText('DECISION', {
      what: 'soft-delete → hard-delete',
      why: 'nothing read archived rows',
      alternatives: 'shared read-helper',
      implications: 'delete is irreversible',
    })
    expect(text).toBe(
      'soft-delete → hard-delete nothing read archived rows shared read-helper delete is irreversible'
    )
  })

  it('expands PROCEDURAL steps array into the text', () => {
    const text = memoryContentToText('PROCEDURAL', {
      workflow: 'add enum safely',
      trigger: 'adding an enum value',
      steps: ['migration 1: add value', 'migration 2: use it'],
    })
    expect(text).toBe(
      'add enum safely adding an enum value migration 1: add value migration 2: use it'
    )
  })

  it('returns empty string for null/non-object content', () => {
    expect(memoryContentToText('TRAP', null)).toBe('')
    expect(memoryContentToText('TRAP', 'oops')).toBe('')
  })

  it('skips empty/whitespace-only string fields', () => {
    expect(memoryContentToText('CONVENTION', { rule: 'use Zod', scope: '   ' })).toBe('use Zod')
  })
})
