import { buildMemoryIndex } from '@/lib/services/memory/index-disclosure'

describe('buildMemoryIndex', () => {
  it('keeps top-K index lines + a pointer for the rest', () => {
    const mems = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`,
      scope: 'PROJECT' as const,
      category: 'DECISION' as const,
      content: { what: `decision ${i}`, why: `because ${i}` },
      source: 'agent' as const,
    }))
    const out = buildMemoryIndex(mems, 8)
    const bulletLines = out.split('\n').filter(l => l.startsWith('- '))
    expect(bulletLines.length).toBe(9) // 8 index lines + 1 pointer line
    expect(out).toContain('+4')
    expect(out).toContain('lumo memory')
  })

  it('returns empty string for no memories', () => {
    expect(buildMemoryIndex([], 8)).toBe('')
  })

  it('omits the pointer when all fit', () => {
    const mems = Array.from({ length: 3 }, (_, i) => ({
      id: `m${i}`,
      scope: 'TASK' as const,
      category: 'TRAP' as const,
      content: { trigger: `t${i}`, outcome: `o${i}` },
      source: 'agent' as const,
    }))
    const out = buildMemoryIndex(mems, 8)
    expect(out).not.toContain('+')
  })
})
