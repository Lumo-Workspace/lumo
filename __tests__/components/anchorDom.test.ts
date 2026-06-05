/** @jest-environment jsdom */
import {
  commentIdFromEventTarget,
  setActiveEditorAnchor,
  flashEditorAnchor,
  docCommentEventNeedsRefetch,
} from '@/app/workspace/[workspaceUrl]/components/document/comments/anchor-dom'

function makeEditor(html: string) {
  const dom = document.createElement('div')
  dom.innerHTML = html
  return { view: { dom } } as never
}

describe('commentIdFromEventTarget', () => {
  it('returns the comment id when clicking inside a comment span', () => {
    const dom = document.createElement('div')
    dom.innerHTML = '<span data-comment-id="c1">hi</span>'
    const inner = dom.querySelector('span')!.firstChild as Node
    expect(commentIdFromEventTarget(inner)).toBe('c1')
  })
  it('returns null outside any comment span', () => {
    const dom = document.createElement('div')
    dom.innerHTML = '<p>plain</p>'
    expect(commentIdFromEventTarget(dom.querySelector('p'))).toBeNull()
  })
})

describe('setActiveEditorAnchor', () => {
  it('adds active class to matching spans and clears others', () => {
    const editor = makeEditor(
      '<span data-comment-id="c1">a</span><span data-comment-id="c2">b</span>'
    )
    setActiveEditorAnchor(editor, 'c1')
    const dom = (editor as { view: { dom: HTMLElement } }).view.dom
    expect(
      dom
        .querySelector('[data-comment-id="c1"]')!
        .classList.contains('comment-highlight--active')
    ).toBe(true)
    expect(
      dom
        .querySelector('[data-comment-id="c2"]')!
        .classList.contains('comment-highlight--active')
    ).toBe(false)
    setActiveEditorAnchor(editor, null)
    expect(
      dom
        .querySelector('[data-comment-id="c1"]')!
        .classList.contains('comment-highlight--active')
    ).toBe(false)
  })
})

describe('flashEditorAnchor', () => {
  it('adds the active class then removes it after the timeout', () => {
    jest.useFakeTimers()
    const editor = makeEditor('<span data-comment-id="c1">a</span>')
    const dom = (editor as { view: { dom: HTMLElement } }).view.dom
    flashEditorAnchor(editor, 'c1')
    expect(
      dom
        .querySelector('[data-comment-id="c1"]')!
        .classList.contains('comment-highlight--active')
    ).toBe(true)
    jest.advanceTimersByTime(1500)
    expect(
      dom
        .querySelector('[data-comment-id="c1"]')!
        .classList.contains('comment-highlight--active')
    ).toBe(false)
    jest.useRealTimers()
  })
})

describe('docCommentEventNeedsRefetch', () => {
  it('is true for doc-comment events, false otherwise', () => {
    expect(
      docCommentEventNeedsRefetch({
        type: 'doc-comment:created',
        commentId: 'x',
      })
    ).toBe(true)
    expect(
      docCommentEventNeedsRefetch({
        type: 'doc-comment:status',
        commentId: 'x',
        status: 'OPEN',
      })
    ).toBe(true)
    expect(
      docCommentEventNeedsRefetch({ type: 'something-else' } as never)
    ).toBe(false)
  })
})
