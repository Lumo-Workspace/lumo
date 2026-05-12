import { applyOperations } from '@/lib/services/lumo-proposal/lumo-md-writer'
import type { ProposalOperation } from '@/lib/validation/lumo-proposal.schema'

const INITIAL_LUMO_MD = `# LUMO.md
<!-- Auto-maintained by Lumo. Do not edit manually. -->

## Traps

- Never use \`router.push\` inside useEffect without deps <!-- from: LUM-12 -->

## Decisions

## Conventions

- Use async/await, never .then() <!-- from: LUM-5 -->

## Procedures
`

describe('applyOperations', () => {
  it('adds a bullet to an existing section', () => {
    const ops: ProposalOperation[] = [
      {
        type: 'add',
        section: 'Traps',
        content: 'Prisma upsert races under concurrency',
        rationale: 'r',
        sourceTaskId: 'LUM-18',
      },
    ]
    const { content, warnings } = applyOperations(INITIAL_LUMO_MD, ops)

    expect(content).toContain(
      '- Prisma upsert races under concurrency <!-- from: LUM-18 -->'
    )
    expect(content).toContain('- Never use `router.push`')
    expect(warnings).toHaveLength(0)
  })

  it('adds a bullet to a non-existent section by creating it', () => {
    const ops: ProposalOperation[] = [
      {
        type: 'add',
        section: 'New Section',
        content: 'Something new',
        rationale: 'r',
        sourceTaskId: 'LUM-99',
      },
    ]
    const { content, warnings } = applyOperations(INITIAL_LUMO_MD, ops)

    expect(content).toContain('## New Section')
    expect(content).toContain('- Something new <!-- from: LUM-99 -->')
    expect(warnings).toHaveLength(0)
  })

  it('modifies an existing bullet', () => {
    const ops: ProposalOperation[] = [
      {
        type: 'modify',
        section: 'Conventions',
        oldContent: 'Use async/await, never .then()',
        newContent:
          'Use async/await exclusively; .then() is banned in all layers',
        rationale: 'r',
        sourceTaskId: 'LUM-20',
      },
    ]
    const { content, warnings } = applyOperations(INITIAL_LUMO_MD, ops)

    expect(content).not.toContain('Use async/await, never .then()')
    expect(content).toContain(
      '- Use async/await exclusively; .then() is banned in all layers <!-- from: LUM-20 -->'
    )
    expect(warnings).toHaveLength(0)
  })

  it('warns when modify cannot find oldContent', () => {
    const ops: ProposalOperation[] = [
      {
        type: 'modify',
        section: 'Conventions',
        oldContent: 'This does not exist',
        newContent: 'Replacement',
        rationale: 'r',
        sourceTaskId: 'LUM-1',
      },
    ]
    const { content, warnings } = applyOperations(INITIAL_LUMO_MD, ops)

    expect(content).toBe(INITIAL_LUMO_MD)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Could not find')
  })

  it('supersedes (removes) an existing bullet', () => {
    const ops: ProposalOperation[] = [
      {
        type: 'supersede',
        section: 'Traps',
        content: 'Never use `router.push` inside useEffect without deps',
        rationale: 'r',
        sourceTaskId: 'LUM-30',
      },
    ]
    const { content, warnings } = applyOperations(INITIAL_LUMO_MD, ops)

    expect(content).not.toContain('router.push')
    expect(warnings).toHaveLength(0)
  })

  it('handles multiple operations in sequence', () => {
    const ops: ProposalOperation[] = [
      {
        type: 'add',
        section: 'Traps',
        content: 'New trap',
        rationale: 'r',
        sourceTaskId: 'LUM-50',
      },
      {
        type: 'supersede',
        section: 'Conventions',
        content: 'Use async/await, never .then()',
        rationale: 'r',
        sourceTaskId: 'LUM-50',
      },
      {
        type: 'add',
        section: 'Conventions',
        content: 'Prefer named exports',
        rationale: 'r',
        sourceTaskId: 'LUM-50',
      },
    ]
    const { content, warnings } = applyOperations(INITIAL_LUMO_MD, ops)

    expect(content).toContain('- New trap <!-- from: LUM-50 -->')
    expect(content).not.toContain('Use async/await, never .then()')
    expect(content).toContain('- Prefer named exports <!-- from: LUM-50 -->')
    expect(warnings).toHaveLength(0)
  })

  it('handles empty LUMO.md (creates sections as needed)', () => {
    const ops: ProposalOperation[] = [
      {
        type: 'add',
        section: 'Traps',
        content: 'Watch out',
        rationale: 'r',
        sourceTaskId: 'LUM-1',
      },
    ]
    const { content, warnings } = applyOperations('', ops)

    expect(content).toContain('## Traps')
    expect(content).toContain('- Watch out <!-- from: LUM-1 -->')
    expect(warnings).toHaveLength(0)
  })
})
