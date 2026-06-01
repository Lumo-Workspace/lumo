/**
 * @jest-environment node
 */
import {
  formatDocListRows,
  formatDocListRowsAsTree,
} from '@/cli/src/commands/doc-list'

describe('formatDocListRows', () => {
  it('renders fixed-width rows', () => {
    const lines = formatDocListRows([
      {
        id: 'cmd1111111111111111111111',
        visibility: 'PRIVATE',
        project: { name: 'Lumo' },
        title: 'Roadmap',
        parentId: null,
        sortOrder: 0,
      },
      {
        id: 'cmd2222222222222222222222',
        visibility: 'WORKSPACE',
        project: null,
        title: 'RFC',
        parentId: null,
        sortOrder: 1,
      },
    ])
    expect(lines[0]).toMatch(
      /^cmd1111111111111111111111\s+PERSONAL\s+Lumo\s+Roadmap$/
    )
    expect(lines[1]).toMatch(
      /^cmd2222222222222222222222\s+WORKSPACE\s+-\s+RFC$/
    )
  })

  it('returns empty array for empty input', () => {
    expect(formatDocListRows([])).toEqual([])
  })
})

describe('formatDocListRows sanitization', () => {
  const row = {
    id: 'cmd1111111111111111111111',
    visibility: 'PRIVATE' as const,
    project: { name: 'Lu\x1bmo' },
    title: 'Road\x1b[31mmap',
    parentId: null,
    sortOrder: 0,
  }
  it('strips control chars from title and project name (flat)', () => {
    const line = formatDocListRows([row])[0]
    expect(line).not.toMatch(/\x1b/)
    expect(line).toContain('Road[31mmap')
    expect(line).toContain('Lumo')
  })
  it('strips control chars from title and project name (tree)', () => {
    const line = formatDocListRowsAsTree([row])[0]
    expect(line).not.toMatch(/\x1b/)
  })
})
