// Mock `marked` before any imports to avoid ESM parse failure
jest.mock('marked', () => ({
  marked: {
    parse: jest.fn((md: string) => `<p>${md}</p>`),
  },
}))

jest.mock('turndown', () => {
  return jest.fn().mockImplementation(() => ({
    turndown: (html: string) => html.replace(/<p>(.*?)<\/p>/g, '$1'),
  }))
})

import { withMarkdown } from '@/lib/services/task-rendering'

describe('withMarkdown', () => {
  it('adds descriptionMarkdown derived from description HTML', () => {
    const out = withMarkdown({ id: 't1', description: '<p>hello</p>' })
    expect(out.descriptionMarkdown).toBe('hello')
    expect(out.description).toBe('<p>hello</p>')
    expect(out.id).toBe('t1')
  })

  it('emits null descriptionMarkdown when description is null', () => {
    const out = withMarkdown({ id: 't1', description: null })
    expect(out.descriptionMarkdown).toBeNull()
    expect(out.description).toBeNull()
  })

  it('preserves all other fields on the input', () => {
    const out = withMarkdown({
      id: 't1',
      description: '<p>x</p>',
      title: 'T',
      status: 'TODO',
    })
    expect(out.title).toBe('T')
    expect(out.status).toBe('TODO')
  })
})
