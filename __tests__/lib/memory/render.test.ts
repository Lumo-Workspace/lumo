/**
 * @jest-environment node
 */
import {
  applyTokenBudget,
  memoryBudgetSection,
  memoryManifestLine,
  renderMemorySection,
  wrapUntrustedLinked,
  wrapUntrustedMemory,
  type RenderableMemory,
} from '@/lib/memory/render'

describe('renderMemorySection', () => {
  it('returns empty string for empty input', () => {
    expect(renderMemorySection([])).toBe('')
  })

  it('renders a TRAP with workaround', () => {
    const out = renderMemorySection([
      {
        id: 'm1',
        scope: 'TASK',
        category: 'TRAP',
        content: {
          trigger: 'running tsc on cli/',
          outcome: 'fails because rootDir excludes lib/',
          workaround: 'use tsc -p cli/tsconfig.json from cli/',
        },
      },
    ])
    expect(out).toContain('## Relevant Memory')
    expect(out).toContain('### Traps')
    expect(out).toContain('[task]')
    expect(out).toContain('**running tsc on cli/**')
    expect(out).toContain('Workaround: use tsc -p cli/tsconfig.json from cli/')
  })

  it('renders a DECISION with what + why', () => {
    const out = renderMemorySection([
      {
        id: 'm2',
        scope: 'PROJECT',
        category: 'DECISION',
        content: {
          what: 'Server-side memory rendering',
          why: 'CLI tsconfig rootDir blocks importing @/lib',
        },
      },
    ])
    expect(out).toContain('### Decisions')
    expect(out).toContain('[project]')
    expect(out).toContain('**Server-side memory rendering**')
    expect(out).toContain('Why: CLI tsconfig rootDir blocks importing @/lib')
  })

  it('renders a CONVENTION with rule + scope', () => {
    const out = renderMemorySection([
      {
        id: 'm3',
        scope: 'PROJECT',
        category: 'CONVENTION',
        content: { rule: 'Prefer named exports', scope: 'app/**' },
      },
    ])
    expect(out).toContain('### Conventions')
    expect(out).toContain('Prefer named exports')
    expect(out).toContain('_(app/**)_')
  })

  it('renders a PROCEDURAL with steps', () => {
    const out = renderMemorySection([
      {
        id: 'm4',
        scope: 'PROJECT',
        category: 'PROCEDURAL',
        content: {
          workflow: 'Adding a new memory category',
          trigger: 'New extraction signal',
          steps: ['add to enum', 'add zod schema', 'add render branch'],
        },
      },
    ])
    expect(out).toContain('### Procedures')
    expect(out).toContain('**Adding a new memory category**')
    expect(out).toContain('Trigger: New extraction signal')
    expect(out).toContain(
      'Steps: add to enum → add zod schema → add render branch'
    )
  })

  it('orders TRAP before DECISION before CONVENTION before PROCEDURAL', () => {
    const out = renderMemorySection([
      {
        id: 'a',
        scope: 'PROJECT',
        category: 'PROCEDURAL',
        content: { workflow: 'w', trigger: 't' },
      },
      {
        id: 'b',
        scope: 'PROJECT',
        category: 'CONVENTION',
        content: { rule: 'r', scope: 's' },
      },
      {
        id: 'c',
        scope: 'PROJECT',
        category: 'DECISION',
        content: { what: 'w', why: 'y' },
      },
      {
        id: 'd',
        scope: 'PROJECT',
        category: 'TRAP',
        content: { trigger: 'x', outcome: 'y' },
      },
    ])
    const trapIdx = out.indexOf('### Traps')
    const decIdx = out.indexOf('### Decisions')
    const convIdx = out.indexOf('### Conventions')
    const procIdx = out.indexOf('### Procedures')
    expect(trapIdx).toBeGreaterThanOrEqual(0)
    expect(trapIdx).toBeLessThan(decIdx)
    expect(decIdx).toBeLessThan(convIdx)
    expect(convIdx).toBeLessThan(procIdx)
  })

  it('falls back to a generic line when content fails parse', () => {
    const out = renderMemorySection([
      {
        id: 'broken',
        scope: 'TASK',
        category: 'TRAP',
        content: { trigger: 'no outcome field' },
      },
    ])
    expect(out).toContain('unparseable')
  })
})

describe('wrapUntrustedMemory', () => {
  it('returns empty string unchanged', () => {
    expect(wrapUntrustedMemory('')).toBe('')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(wrapUntrustedMemory('   \n  ')).toBe('')
  })

  it('wraps non-empty content in an explicit untrusted-team-memory boundary', () => {
    const out = wrapUntrustedMemory('## Relevant Memory\n\n- [task] X\n')
    expect(out.startsWith('<untrusted-team-memory>')).toBe(true)
    expect(out.trimEnd().endsWith('</untrusted-team-memory>')).toBe(true)
  })

  it('marks the content as reference data, not instructions', () => {
    const out = wrapUntrustedMemory('## Relevant Memory\n\n- [task] X\n')
    expect(out).toContain('NOT')
    expect(out.toLowerCase()).toContain('instruction')
    // The notice must tell the assistant not to obey directives in the block.
    expect(out.toLowerCase()).toMatch(/do not (obey|execute|act)/)
  })

  it('preserves the original section content inside the boundary', () => {
    const inner = '## Relevant Memory\n\n### Traps\n- [task] **trig** → out\n'
    const out = wrapUntrustedMemory(inner)
    expect(out).toContain('## Relevant Memory')
    expect(out).toContain('### Traps')
    expect(out).toContain('**trig** → out')
  })
})

describe('applyTokenBudget', () => {
  function memOfSize(id: string, chars: number): RenderableMemory {
    return {
      id,
      scope: 'PROJECT',
      category: 'CONVENTION',
      content: { rule: 'x'.repeat(chars), scope: 's' },
    }
  }

  it('returns all items when total fits in budget', () => {
    const memories = [memOfSize('a', 40), memOfSize('b', 40)]
    const out = applyTokenBudget(memories, 1000)
    expect(out).toHaveLength(2)
  })

  it('drops the tail when budget overflows', () => {
    // Each ~400 chars → ~100 tokens. Budget 150 fits one but not two.
    const memories = [
      memOfSize('keep', 400),
      memOfSize('drop1', 400),
      memOfSize('drop2', 400),
    ]
    const out = applyTokenBudget(memories, 150)
    expect(out.map(m => m.id)).toEqual(['keep'])
  })

  it('caps even a flood of memories at the budget', () => {
    const memories = Array.from({ length: 100 }, (_, i) =>
      memOfSize(`m${i}`, 100)
    )
    const out = applyTokenBudget(memories, 1000)
    // Each ~120 chars → ~30 tokens. 1000 / 30 ≈ 33 items max.
    expect(out.length).toBeLessThan(40)
    expect(out.length).toBeGreaterThan(20)
  })
})

describe('memoryManifestLine (LUM-147)', () => {
  it('renders a one-line trap manifest with scope tag', () => {
    const line = memoryManifestLine({
      id: 'm1',
      scope: 'PROJECT',
      category: 'TRAP',
      content: { trigger: 'Do X before Y', outcome: 'crash' },
    })
    expect(line).toBe('- [project] Do X before Y')
  })

  it('truncates long headlines to 100 chars with an ellipsis', () => {
    const long = 'a'.repeat(200)
    const line = memoryManifestLine({
      id: 'm2',
      scope: 'TASK',
      category: 'CONVENTION',
      content: { rule: long, scope: 'where' },
    })
    expect(line.startsWith('- [task] ')).toBe(true)
    expect(line.length).toBeLessThanOrEqual('- [task] '.length + 101)
    expect(line.endsWith('…')).toBe(true)
  })

  it('falls back gracefully on unparseable content', () => {
    const line = memoryManifestLine({
      id: 'm3',
      scope: 'TASK',
      category: 'TRAP',
      content: { bogus: true },
    })
    expect(line.startsWith('- [task] ')).toBe(true)
  })
})

describe('memoryBudgetSection (LUM-147)', () => {
  const mem = (id: string, trigger: string) => ({
    id,
    scope: 'PROJECT' as const,
    category: 'TRAP' as const,
    content: { trigger, outcome: 'boom' },
  })

  it('render(all) equals the grouped renderMemorySection output', () => {
    const items = [mem('a', 'one'), mem('b', 'two')]
    const section = memoryBudgetSection(items)
    expect(section.render(2)).toBe(renderMemorySection(items))
  })

  it('render(partial) keeps the grouped fulls and lists the rest as manifest', () => {
    const items = [mem('a', 'one'), mem('b', 'two')]
    const out = memoryBudgetSection(items).render(1)
    expect(out).toContain(renderMemorySection([mem('a', 'one')]))
    expect(out).toContain('其余 1 条记忆（仅清单）：')
    expect(out).toContain('- [project] two')
  })

  it('render(0) emits only the heading + manifest list', () => {
    const items = [mem('a', 'one')]
    const out = memoryBudgetSection(items).render(0)
    expect(out).toContain('## Relevant Memory')
    expect(out).toContain('- [project] one')
  })

  it('cardTokens has one entry per memory', () => {
    expect(memoryBudgetSection([mem('a', 'x'), mem('b', 'y')]).cardTokens).toHaveLength(2)
  })
})

describe('wrapUntrustedLinked (LUM-147)', () => {
  it('wraps non-empty content in an untrusted-linked boundary', () => {
    const out = wrapUntrustedLinked('## Slack Context\nhi')
    expect(out.startsWith('<untrusted-linked-context>')).toBe(true)
    expect(out.endsWith('</untrusted-linked-context>')).toBe(true)
    expect(out).toContain('## Slack Context')
  })

  it('returns "" for empty/whitespace input', () => {
    expect(wrapUntrustedLinked('')).toBe('')
    expect(wrapUntrustedLinked('   ')).toBe('')
  })
})
