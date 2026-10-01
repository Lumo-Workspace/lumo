/**
 * @jest-environment jsdom
 */
/**
 * LUM-921: comment previews used to do `div.innerHTML = body` on an element of
 * the page's own document — even unmounted, `<img src=x onerror=…>` loads and
 * the handler runs on Lumo's origin. The preview must never parse the body
 * into the live document.
 */
import { commentPreviewText } from '@/lib/html/comment-preview-text'
import { previewCommentText } from '@/app/workspace/[workspaceUrl]/components/comments/CommentQuote'

const MALICIOUS =
  '<p>hi <img src=x onerror="window.__lum921=1"><svg onload="window.__lum921=2"></svg><script>window.__lum921=3</script>there</p>'

const innerHtml = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'innerHTML'
)!

describe('comment preview text never parses body into the live document', () => {
  let setterSpy: jest.Mock
  let createSpy: jest.SpyInstance

  beforeEach(() => {
    setterSpy = jest.fn()
    Object.defineProperty(Element.prototype, 'innerHTML', {
      ...innerHtml,
      set(this: Element, v: string) {
        if (this.ownerDocument === document) setterSpy(v)
        innerHtml.set!.call(this, v)
      },
    })
    createSpy = jest.spyOn(document, 'createElement')
    delete (window as unknown as Record<string, unknown>).__lum921
  })

  afterEach(() => {
    Object.defineProperty(Element.prototype, 'innerHTML', innerHtml)
    createSpy.mockRestore()
  })

  it.each([
    ['commentPreviewText', commentPreviewText],
    ['previewCommentText', previewCommentText],
  ])('%s extracts text without touching the page document', async (_n, fn) => {
    expect(fn(MALICIOUS)).toBe('hi there')
    // let any queued load/error events fire
    await new Promise(r => setTimeout(r, 20))
    expect(setterSpy).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
    expect(
      (window as unknown as Record<string, unknown>).__lum921
    ).toBeUndefined()
    expect(document.querySelector('img, svg, script')).toBeNull()
  })

  it('truncates to 120 chars and falls back to an ellipsis for empty text', () => {
    const long = `<p>${'a'.repeat(300)}</p>`
    expect(commentPreviewText(long)).toBe('a'.repeat(120))
    expect(commentPreviewText('<p>   </p><img src=x>')).toBe('…')
  })

  it('without a DOM it strips tags into plain text', () => {
    const original = globalThis.DOMParser
    // @ts-expect-error simulate SSR
    delete globalThis.DOMParser
    try {
      expect(commentPreviewText('<p>a <b>b</b></p>')).toBe('a b')
    } finally {
      globalThis.DOMParser = original
    }
  })
})
