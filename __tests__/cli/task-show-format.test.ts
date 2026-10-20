/**
 * @jest-environment node
 */
import { formatTaskShow } from '@/cli/src/commands/task-show'

const base = {
  id: 't1',
  identifier: 'LUM-1',
  title: 'T',
  status: 'TODO',
  priority: 'LOW',
  url: 'https://example.com/LUM-1',
  project: { id: 'p1', name: 'P' },
  assignee: null,
}

describe('formatTaskShow', () => {
  it('prefers descriptionMarkdown when available', () => {
    const out = formatTaskShow({
      ...base,
      description: '<p>html body</p>',
      descriptionMarkdown: '## md heading',
    } as any)
    expect(out).toContain('## md heading')
    expect(out).not.toContain('<p>html body</p>')
  })

  it('falls back to description when descriptionMarkdown is absent', () => {
    const out = formatTaskShow({
      ...base,
      description: 'plain body',
    } as any)
    expect(out).toContain('plain body')
  })

  it('falls back to description when descriptionMarkdown is explicitly null', () => {
    const out = formatTaskShow({
      ...base,
      description: 'fallback body',
      descriptionMarkdown: null,
    } as any)
    expect(out).toContain('fallback body')
  })

  it('omits Description block when both fields are empty', () => {
    const out = formatTaskShow({
      ...base,
      description: null,
      descriptionMarkdown: null,
    } as any)
    expect(out).not.toContain('Description:')
  })
})

describe('formatTaskShow — Created by (LUM-1283)', () => {
  it('renders the creating member as Name <email>', () => {
    const out = formatTaskShow({
      ...base,
      description: null,
      createdBy: { name: 'Alice', email: 'a@example.com' },
    } as any)
    expect(out).toMatch(/Created by:\s+Alice <a@example\.com>/)
  })

  it('renders the bare name when the member has no email', () => {
    const out = formatTaskShow({
      ...base,
      description: null,
      createdBy: { name: '(unknown member)', email: null },
    } as any)
    expect(out).toMatch(/Created by:\s+\(unknown member\)$/m)
  })

  it('renders an unrecorded creator as the empty marker', () => {
    const out = formatTaskShow({
      ...base,
      description: null,
      createdBy: null,
    } as any)
    expect(out).toMatch(/Created by:\s+-$/m)
  })

  it('omits the row when an older server sends no createdBy field', () => {
    const out = formatTaskShow({ ...base, description: null } as any)
    expect(out).not.toContain('Created by')
  })
})
