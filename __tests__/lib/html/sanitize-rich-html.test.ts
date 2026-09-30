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

import { editorHtml, normalize } from '@/test-utils/rich-html-fixture'
import { sanitizeRichHtml } from '@/lib/html/sanitize-rich-html'
import { sanitizeRichHtmlInBrowser } from '@/lib/html/sanitize-rich-html.client'

const SANITIZERS = [
  ['server (sanitize-html)', sanitizeRichHtml],
  ['browser (DOMPurify)', sanitizeRichHtmlInBrowser],
] as const

describe.each(SANITIZERS)(
  'rich html sanitizer · %s',
  (_label, sanitizeRichHtml) => {
    it('leaves everything the editor emits unchanged', () => {
      const html = editorHtml()

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
