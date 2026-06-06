/** @jest-environment jsdom */
import {
  commentIdFromEventTarget,
  setActiveEditorAnchor,
  setResolvedEditorAnchors,
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

describe('setResolvedEditorAnchors', () => {
  it('marks resolved spans and clears spans no longer resolved', () => {
    const editor = makeEditor(
      '<span data-comment-id="c1">a</span><span data-comment-id="c2">b</span>'
    )
    const dom = (editor as { view: { dom: HTMLElement } }).view.dom
    const cls = 'comment-highlight--resolved'

    setResolvedEditorAnchors(editor, ['c1'])
    expect(
      dom.querySelector('[data-comment-id="c1"]')!.classList.contains(cls)
    ).toBe(true)
    expect(
      dom.querySelector('[data-comment-id="c2"]')!.classList.contains(cls)
    ).toBe(false)

    // Reopening c1 (now empty set) clears the class again.
    setResolvedEditorAnchors(editor, [])
    expect(
      dom.querySelector('[data-comment-id="c1"]')!.classList.contains(cls)
    ).toBe(false)
  })

  it('accepts a Set and tolerates ids with no span in the doc', () => {
    const editor = makeEditor('<span data-comment-id="c1">a</span>')
    const dom = (editor as { view: { dom: HTMLElement } }).view.dom
    expect(() =>
      setResolvedEditorAnchors(editor, new Set(['c1', 'ghost']))
    ).not.toThrow()
    expect(
      dom
        .querySelector('[data-comment-id="c1"]')!
        .classList.contains('comment-highlight--resolved')
    ).toBe(true)
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
