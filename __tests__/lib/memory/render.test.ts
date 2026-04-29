/**
 * @jest-environment node
 */
import {
  applyTokenBudget,
  renderMemorySection,
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
