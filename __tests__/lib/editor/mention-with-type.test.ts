import {
  renderMentionHTML,
  renderMentionText,
} from '@/lib/editor/nodes/mention-with-type'

describe('renderMentionHTML', () => {
  it('renders a user mention as a span with @label, no data-href', () => {
    const [tag, attrs, text] = renderMentionHTML(
      { mentionType: 'user', id: 'user_a', label: 'Alice' },
      { 'data-id': 'user_a', 'data-mention-type': 'user' }
    )
    expect(tag).toBe('span')
    expect(text).toBe('@Alice')
    expect(attrs.class).toContain('mention')
    expect(attrs['data-href']).toBeUndefined()
  })

  it('renders an entity mention as a clickable anchor with href + kind class', () => {
    const [tag, attrs, text] = renderMentionHTML(
      {
        mentionType: 'sprint',
        id: 'sp_1',
        label: 'Sprint 14',
        mentionHref: '/workspace/acme/sprints/14',
      },
      {
        'data-id': 'sp_1',
        'data-mention-type': 'sprint',
        'data-href': '/workspace/acme/sprints/14',
      }
    )
    expect(tag).toBe('a')
    expect(attrs.href).toBe('/workspace/acme/sprints/14')
    expect(attrs.class).toContain('mention-sprint')
    expect(text).toBe('Sprint 14')
  })

  it('task mention keeps "LABEL title" text and task class', () => {
    const [, attrs, text] = renderMentionHTML(
      {
        mentionType: 'task',
        id: 't1',
        label: 'LUM-1',
        mentionTitle: 'Fix',
        mentionHref: '/x',
      },
      { 'data-id': 't1', 'data-mention-type': 'task', 'data-href': '/x' }
    )
    expect(attrs.class).toContain('mention-task')
    expect(text).toBe('LUM-1 Fix')
  })
})

describe('renderMentionText', () => {
  it('user → @label, entity → label', () => {
    expect(renderMentionText({ mentionType: 'user', label: 'Bob' })).toBe(
      '@Bob'
    )
    expect(renderMentionText({ mentionType: 'project', label: 'Lumo' })).toBe(
      'Lumo'
    )
  })
})
