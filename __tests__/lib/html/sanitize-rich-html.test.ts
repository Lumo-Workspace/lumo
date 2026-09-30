/**
 * LUM-916: stored rich-text HTML is sanitized before any
 * dangerouslySetInnerHTML. Two halves:
 *   - fidelity: everything the real editor emits survives byte-for-byte
 *   - safety: script vectors, dangerous URLs and UI-spoofing are stripped
 */
// The code-block node view pulls react-intl (ESM) in; rendering HTML never
// touches it.
jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: () => '' }),
}))

import { Editor } from '@tiptap/core'
import { getBaseExtensions } from '@/lib/editor/extensions'
import { sanitizeRichHtml } from '@/lib/html/sanitize-rich-html'
import { sanitizeRichHtmlInBrowser } from '@/lib/html/sanitize-rich-html.client'

/**
 * Semantic form of an HTML string: parsed by the DOM, attributes sorted,
 * inline style re-serialised by the CSS parser, boolean attributes and the
 * forced `disabled` on checkboxes folded — so only a CONTENT difference
 * (a dropped tag, attribute, class or style) fails a comparison.
 */
function normalize(html: string): string {
  const root = document.createElement('div')
  root.innerHTML = html
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.hasAttribute('style'))
      el.setAttribute('style', (el as HTMLElement).style.cssText)
    if (el.tagName === 'INPUT') el.removeAttribute('disabled')
    const attrs = Array.from(el.attributes)
      .map(a => [a.name, a.name === 'checked' ? '' : a.value] as const)
      .sort(([a], [b]) => a.localeCompare(b))
    for (const [name] of attrs) el.removeAttribute(name)
    for (const [name, value] of attrs) el.setAttribute(name, value)
  }
  return root.innerHTML
}

const SANITIZERS = [
  ['server (sanitize-html)', sanitizeRichHtml],
  ['browser (DOMPurify)', sanitizeRichHtmlInBrowser],
] as const

/** Every node/mark the editor supports, parsed and re-serialised BY the editor. */
const AUTHORED = `
<h1>Title</h1><h2 style="text-align: center">Centered</h2>
<p>plain <strong>bold</strong> <em>it</em> <u>under</u> <s>strike</s> <code>code</code>
 <a href="https://example.com/x" target="_blank">link</a>
 <span style="color: #ff0000">red</span> <mark data-color="#fef08a" style="background-color: #fef08a; color: inherit">hl</mark>
 <span data-type="mention" data-id="u1" data-label="Alice" data-mention-type="user">@Alice</span>
 <a data-type="mention" data-id="t1" data-label="LUM-1" data-mention-type="task" data-href="/workspace/acme/my-tasks/LUM-1" href="/workspace/acme/my-tasks/LUM-1">LUM-1</a>
 <span data-comment-id="c1">commented</span></p>
<ul><li><p>bullet</p></li></ul><ol start="3"><li><p>numbered</p></li></ol>
<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>done</p></div></li></ul>
<blockquote><p>quote</p></blockquote>
<pre><code class="language-ts">const x = 1</code></pre>
<hr>
<img src="https://www.uselumo.ai/api/files/workspaces/ws1/images/abc" alt="shot">
<table><tbody><tr><th colspan="1" rowspan="1"><p>h</p></th></tr><tr><td colspan="1" rowspan="1"><p>c</p></td></tr></tbody></table>
<div data-callout data-variant="info"><p>callout</p></div>
<pre data-type="mermaid"><code>graph TD; A--&gt;B</code></pre>
<div data-toggle><div data-toggle-summary>sum</div><div data-toggle-content><p>body</p></div></div>
`

describe.each(SANITIZERS)(
  'rich html sanitizer · %s',
  (_label, sanitizeRichHtml) => {
    it('leaves everything the editor emits unchanged', () => {
      const editor = new Editor({
        extensions: getBaseExtensions(),
        content: AUTHORED,
      })
      // Mentions are inserted as nodes (as the '@' picker does), not parsed.
      editor.commands.insertContentAt(1, [
        {
          type: 'mention',
          attrs: { id: 'u1', label: 'Alice', mentionType: 'user' },
        },
        {
          type: 'mention',
          attrs: {
            id: 't1',
            label: 'LUM-1',
            mentionType: 'task',
            mentionHref: '/workspace/acme/my-tasks/LUM-1',
          },
        },
      ])
      const html = editor.getHTML()
      editor.destroy()

      // The fixture must really exercise the features (not a vacuous pass).
      for (const needle of [
        '<h2 style="text-align: center',
        'style="color: rgb(255, 0, 0);"',
        '<mark',
        'mention mention-user',
        'mention mention-task',
        'data-comment-id="c1"',
        'data-type="taskList"',
        'type="checkbox"',
        'class="language-ts"',
        '/api/files/workspaces/ws1/images/abc',
        '<table',
        'data-callout',
        'data-type="mermaid"',
        'data-toggle',
        'target="_blank"',
      ]) {
        expect(html).toContain(needle)
      }
      expect(normalize(sanitizeRichHtml(html))).toBe(normalize(html))
    })

    it('keeps revision-diff markup and relative Lumo links', () => {
      const diff =
        '<p>a <ins data-diff="added" class="diff-ins">new</ins> <del data-diff="removed" class="diff-del">old</del> <a href="/workspace/acme">ws</a></p>'
      expect(normalize(sanitizeRichHtml(diff))).toBe(normalize(diff))
    })

    it.each([
      [
        'event handler',
        '<img src="https://x.test/a.png" onerror="alert(1)">',
        /onerror/,
      ],
      ['script tag', '<p>hi</p><script>alert(1)</script>', /script|alert/],
      ['javascript: link', '<a href="javascript:alert(1)">x</a>', /javascript/],
      [
        'data: link',
        '<a href="data:text/html,<script>alert(1)</script>">x</a>',
        /data:|script/,
      ],
      [
        'data: image',
        '<img src="data:image/svg+xml;base64,PHN2Zz4=">',
        /data:/,
      ],
      ['iframe', '<iframe src="https://evil.test"></iframe>', /iframe|evil/],
      ['svg', '<svg><script>alert(1)</script></svg>', /svg|script/],
      [
        'form + text input',
        '<form action="https://evil.test"><input type="password" name="p"></form>',
        /form|password|evil/,
      ],
      ['style tag', '<style>body{display:none}</style>', /style|display/],
      [
        'url() in style',
        '<p style="background-color: url(https://evil.test/x)">x</p>',
        /url\(|evil/,
      ],
      [
        'overlay class',
        '<div class="fixed inset-0 z-50 bg-white">fake login</div>',
        /fixed|inset|z-50/,
      ],
      ['protocol-relative', '<a href="//evil.test/x">x</a>', /evil/],
      [
        'obfuscated javascript: link',
        '<a href="java\tscript:alert(1)">x</a>',
        /script|alert/,
      ],
      [
        'entity-encoded javascript: link',
        '<a href="&#106;avascript:alert(1)">x</a>',
        /script|alert|&#106;/,
      ],
      [
        'unknown attribute',
        '<p onclick="x()" formaction="y">p</p>',
        /onclick|formaction/,
      ],
      [
        'style expression',
        '<span style="color: expression(alert(1))">x</span>',
        /expression|alert/,
      ],
      [
        'class on a tag without a class allowlist',
        '<p class="fixed inset-0">x</p>',
        /fixed|inset/,
      ],
      [
        'unlisted class values on span/a',
        '<span class="mention fixed inset-0 z-50">x</span><a href="/x" class="task-link absolute top-0">y</a>',
        /fixed|inset|z-50|absolute|top-0/,
      ],
    ])('strips %s', (_name, input, forbidden) => {
      expect(sanitizeRichHtml(input)).not.toMatch(forbidden)
    })

    it('forces noopener on new-tab links and only ever renders a disabled checkbox', () => {
      const link = sanitizeRichHtml(
        '<a href="https://x.test" target="_blank" rel="opener">x</a>'
      )
      expect(normalize(link)).toBe(
        normalize(
          '<a href="https://x.test" target="_blank" rel="noopener noreferrer nofollow">x</a>'
        )
      )
      const input = document.createElement('div')
      input.innerHTML = sanitizeRichHtml(
        '<input type="text" value="p" checked>'
      )
      const el = input.querySelector('input')!
      expect(el.getAttribute('type')).toBe('checkbox')
      expect(el.hasAttribute('disabled')).toBe(true)
      expect(el.hasAttribute('checked')).toBe(true)
      expect(el.hasAttribute('value')).toBe(false)
    })

    it('returns an empty string for null / empty input', () => {
      expect(sanitizeRichHtml(null)).toBe('')
      expect(sanitizeRichHtml(undefined)).toBe('')
      expect(sanitizeRichHtml('')).toBe('')
    })
  }
)
