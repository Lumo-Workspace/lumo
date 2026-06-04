import {
  renderMentionHTML,
  renderMentionText,
  MentionWithType,
} from '@/lib/editor/nodes/mention-with-type'

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
})

describe('renderMentionHTML', () => {
  it('tags a task mention with mention-task class + data attrs', () => {
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
    expect(tag).toBe('span')
    expect(attrs.class).toBe('mention mention-task')
    expect(attrs['data-mention-type']).toBe('task')
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

  it('renders a user mention with the plain mention class and @label', () => {
    const [tag, attrs, text] = renderMentionHTML(
      { mentionType: 'user', label: 'alice', id: '1' },
      {}
    )
    expect(tag).toBe('span')
    expect(attrs.class).toBe('mention')
    expect(text).toBe('@alice')
  })
})

describe('MentionWithType', () => {
  it('is a configured Tiptap extension named "mention"', () => {
    expect(MentionWithType.name).toBe('mention')
  })
})
