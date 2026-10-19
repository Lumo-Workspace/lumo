/** @jest-environment node */
import {
  buildMemoryContent,
  formatMemoryList,
} from '@/cli/src/lib/memory-content'

describe('buildMemoryContent', () => {
  it('builds a TRAP, trimming and dropping empty workaround', () => {
    const r = buildMemoryContent('trap', {
      trigger: ' t ',
      outcome: ' o ',
      workaround: '  ',
    })
    expect(r).toEqual({
      ok: true,
      category: 'TRAP',
      content: { trigger: 't', outcome: 'o' },
    })
  })
  it('keeps a non-empty TRAP workaround', () => {
    const r = buildMemoryContent('trap', {
      trigger: 't',
      outcome: 'o',
      workaround: 'w',
    })
    expect(r).toEqual({
      ok: true,
      category: 'TRAP',
      content: { trigger: 't', outcome: 'o', workaround: 'w' },
    })
  })
  it('errors on a missing required TRAP field', () => {
    const r = buildMemoryContent('trap', { trigger: 't' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/outcome/)
  })
  it('builds a DECISION dropping empty optionals', () => {
    const r = buildMemoryContent('decision', {
      what: 'a',
      why: 'b',
      alternatives: '',
      implications: '',
    })
    expect(r).toEqual({
      ok: true,
      category: 'DECISION',
      content: { what: 'a', why: 'b' },
    })
  })
  it('builds a DECISION dropping whitespace-only optionals and trimming kept ones', () => {
    const r = buildMemoryContent('decision', {
      what: ' a ',
      why: ' b ',
      alternatives: '   ',
      implications: ' x ',
    })
    expect(r).toEqual({
      ok: true,
      category: 'DECISION',
      content: { what: 'a', why: 'b', implications: 'x' },
    })
  })
  it('maps --applies to convention content.scope', () => {
    const r = buildMemoryContent('convention', {
      rule: 'r',
      applies: 'everywhere',
    })
    expect(r).toEqual({
      ok: true,
      category: 'CONVENTION',
      content: { rule: 'r', scope: 'everywhere' },
    })
  })
  it('errors when convention --applies is missing', () => {
    const r = buildMemoryContent('convention', { rule: 'r' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/applies/)
  })
  it('builds a PROCEDURAL with repeated --step, trimming/filtering empties', () => {
    const r = buildMemoryContent('procedural', {
      workflow: 'w',
      trigger: 't',
      step: [' s1 ', '  ', 's2'],
    })
    expect(r).toEqual({
      ok: true,
      category: 'PROCEDURAL',
      content: { workflow: 'w', trigger: 't', steps: ['s1', 's2'] },
    })
  })
  it('omits steps when none non-empty', () => {
    const r = buildMemoryContent('procedural', {
      workflow: 'w',
      trigger: 't',
      step: ['', ' '],
    })
    expect(r).toEqual({
      ok: true,
      category: 'PROCEDURAL',
      content: { workflow: 'w', trigger: 't' },
    })
  })
  it('errors on an unknown category', () => {
    const r = buildMemoryContent('nope', { trigger: 't', outcome: 'o' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/category/i)
  })
})

describe('formatMemoryList', () => {
  const rows = [
    {
      id: 'cmd_x',
      scope: 'TASK',
      category: 'TRAP',
      content: { trigger: 'enum mid-migration fails', outcome: 'P3009' },
      createdByMemberId: null,
    },
    {
      id: 'cmd_y',
      scope: 'PROJECT',
      category: 'CONVENTION',
      content: { rule: 'use Zod', scope: 'all' },
      createdByMemberId: 'm1',
    },
  ]
  it('renders id-first rows with auto/manual source and a headline', () => {
    const out = formatMemoryList(rows as any)
    expect(out).toBe(
      [
        'cmd_x\tTASK\tTRAP\tauto\tenum mid-migration fails',
        'cmd_y\tPROJECT\tCONVENTION\tmanual\tuse Zod',
      ].join('\n')
    )
  })
  it('handles an empty list', () => {
    expect(formatMemoryList([])).toBe('No memories.')
  })
})
