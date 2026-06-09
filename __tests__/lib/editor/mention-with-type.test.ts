import {
  renderMentionHTML,
  renderMentionText,
  MentionWithType,
} from '@/lib/editor/nodes/mention-with-type'

describe('renderMentionHTML', () => {
  it('renders a user mention as a span with the mention-user class, @label, no link', () => {
    const [tag, attrs, text] = renderMentionHTML(
      { mentionType: 'user', id: 'user_a', label: 'Alice' },
      { 'data-id': 'user_a', 'data-mention-type': 'user' }
    )
    expect(tag).toBe('span')
    expect(attrs.class).toBe('mention mention-user')
    expect(text).toBe('@Alice')
    expect(attrs.href).toBeUndefined()
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

  it('tags a task mention with the mention-task class, status attr + "label title" text', () => {
    const [tag, attrs, text] = renderMentionHTML(
      {
        mentionType: 'task',
        label: 'LUM-5',
        mentionTitle: 'Fix bug',
        mentionStatus: 'IN_PROGRESS',
        id: '5',
      },
      {}
    )
    expect(tag).toBe('a')
    expect(attrs.class).toBe('mention mention-task')
    expect(attrs['data-mention-status']).toBe('IN_PROGRESS')
    expect(text).toBe('LUM-5 Fix bug')
  })

  it('omits data-mention-status when status is null', () => {
    const [, attrs] = renderMentionHTML(
      { mentionType: 'task', label: 'LUM-5', mentionStatus: null, id: '5' },
      {}
    )
    expect('data-mention-status' in attrs).toBe(false)
  })
})

describe('renderMentionText', () => {
  it('renders a user mention as @label', () => {
    expect(
      renderMentionText({ mentionType: 'user', label: 'alice', id: '1' })
    ).toBe('@alice')
  })

  it('falls back to id when a user mention has no label', () => {
    expect(
      renderMentionText({ mentionType: 'user', label: null, id: '1' })
    ).toBe('@1')
  })

  it('renders a task mention as "label title" when a title is present', () => {
    expect(
      renderMentionText({
        mentionType: 'task',
        label: 'LUM-5',
        mentionTitle: 'Fix bug',
        id: '5',
      })
    ).toBe('LUM-5 Fix bug')
  })

  it('renders a task mention as just the label when no title', () => {
    expect(
      renderMentionText({
        mentionType: 'task',
        label: 'LUM-5',
        mentionTitle: null,
        id: '5',
      })
    ).toBe('LUM-5')
  })

  it('renders a non-task entity mention as the bare label', () => {
    expect(renderMentionText({ mentionType: 'project', label: 'Lumo' })).toBe(
      'Lumo'
    )
  })
})

describe('MentionWithType', () => {
  it('is a configured Tiptap extension named "mention"', () => {
    expect(MentionWithType.name).toBe('mention')
  })
})
