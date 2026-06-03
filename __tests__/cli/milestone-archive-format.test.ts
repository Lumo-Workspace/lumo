/**
 * @jest-environment node
 */
import { formatArchiveResult } from '@/cli/src/commands/milestone-archive'
import { formatUnarchiveResult } from '@/cli/src/commands/milestone-unarchive'

describe('milestone archive/unarchive output', () => {
  it('formats the archive success line', () => {
    expect(formatArchiveResult('Q3 Launch')).toBe('Archived "Q3 Launch"')
  })

  it('formats the unarchive success line', () => {
    expect(formatUnarchiveResult('Q3 Launch')).toBe('Unarchived "Q3 Launch"')
  })

  it('sanitizes the milestone name', () => {
    expect(formatArchiveResult('a[31mb')).not.toContain('')
  })
})
