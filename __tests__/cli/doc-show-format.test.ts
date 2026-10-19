/**
 * @jest-environment node
 */
import { formatShowOutput } from '@/cli/src/commands/doc-show'

describe('formatShowOutput', () => {
  it('renders a key:value header and body separated by blank line', () => {
    const out = formatShowOutput({
      id: 'c1',
      title: 'RFC: doc CLI',
      scope: 'WORKSPACE',
      projectName: 'Lumo',
      createdAt: '2026-05-22T10:00:00Z',
      updatedAt: '2026-05-22T10:30:00Z',
      revision: 3,
      mentionedTasks: ['LUM-42'],
      bodyMarkdown: '# Hello\n\nWorld\n',
    })
    // LUM-1230: no slug known for this fixture → falls back to the id.
    expect(out).toContain('Ref: c1')
    expect(out).toContain('Revision: 3')
    expect(out).toContain('Title: RFC: doc CLI')
    expect(out).toContain('Scope: workspace')
    expect(out).toContain('Project: Lumo')
    expect(out).toContain('Mentioned tasks: LUM-42')
    expect(out).toMatch(/\n\n# Hello\n\nWorld/)
  })

  it('LUM-1230: names the doc by its slug, never the cuid', () => {
    const out = formatShowOutput({
      id: 'cmpib7orx001h04jov9tlyy5x',
      slug: 'rfc-doc-cli-42',
      title: 'RFC: doc CLI',
      scope: 'WORKSPACE',
      projectName: 'Lumo',
      createdAt: '2026-05-22T10:00:00Z',
      updatedAt: '2026-05-22T10:30:00Z',
      revision: 3,
      mentionedTasks: [],
      bodyMarkdown: '# Hello\n',
    })
    expect(out).toContain('Ref: rfc-doc-cli-42')
    expect(out).not.toContain('cmpib7orx001h04jov9tlyy5x')
  })

  it('renders dash for empty project / mentions and personal scope', () => {
    const out = formatShowOutput({
      id: 'c1',
      title: 't',
      scope: 'PRIVATE',
      projectName: null,
      createdAt: '2026-05-22T10:00:00Z',
      updatedAt: '2026-05-22T10:00:00Z',
      revision: null,
      mentionedTasks: [],
      bodyMarkdown: '',
    })
    expect(out).toContain('Project: -')
    expect(out).toContain('Revision: -')
    expect(out).toContain('Mentioned tasks: -')
    expect(out).toContain('Scope: personal')
  })
})
