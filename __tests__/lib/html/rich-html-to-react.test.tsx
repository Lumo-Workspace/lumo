/**
 * LUM-916: the public share page renders stored rich-text HTML as React
 * elements (sanitize → parse → rebuild), never through innerHTML.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: () => '' }),
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { richHtmlToReact } from '@/lib/html/rich-html-to-react'
import { sanitizeRichHtml } from '@/lib/html/sanitize-rich-html'
import { editorHtml, normalize } from '@/test-utils/rich-html-fixture'

function render(
  html: string,
  transformUrl?: (url: string, tag: string) => string
) {
  return renderToStaticMarkup(
    <>{richHtmlToReact(html, transformUrl ? { transformUrl } : {})}</>
  )
}

/**
 * Not content: React marks the read-only checkbox `readOnly`, and React 19's
 * renderer hoists a `<link rel="preload">` hint for each image.
 */
const dropReadOnly = (html: string) =>
  html
    .replace(/ readonly=""/gi, '')
    .replace(/<link [^>]*rel="preload"[^>]*\/>/g, '')

describe('share page renders rich html without innerHTML', () => {
  it('renders exactly what the sanitizer keeps, for everything the editor emits', () => {
    const html = editorHtml()
    expect(normalize(dropReadOnly(render(html)))).toBe(
      normalize(sanitizeRichHtml(html))
    )
  })

  it('renders without React warnings (no invalid props, no whitespace in tables)', () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(editorHtml())
      render(
        '<table>\n  <tbody>\n    <tr>\n      <td>x</td>\n    </tr>\n  </tbody>\n</table>'
      )
      expect(errors).not.toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
  })

  it('never emits event handlers, scripts or javascript: URLs', () => {
    const out = render(
      '<p><img src="x" onerror="alert(1)"><a href="javascript:alert(2)">a</a></p>' +
        '<script>alert(3)</script><iframe src="https://evil.test"></iframe>' +
        '<svg onload="alert(4)"></svg>'
    )
    expect(out).not.toMatch(
      /onerror|onload|javascript|script|iframe|svg|alert/i
    )
    expect(out).toContain('<img src="x"/>')
  })

  it('escapes text instead of interpreting it', () => {
    expect(render('<p>&lt;img src=x onerror=alert(1)&gt;</p>')).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>'
    )
  })

  it('hands every href/src to transformUrl', () => {
    const seen: string[] = []
    const out = render(
      '<p><a href="/a">a</a></p><img src="/api/files/x">',
      (url, tag) => {
        seen.push(`${tag}:${url}`)
        return `${url}?t=1`
      }
    )
    expect(seen).toEqual(['a:/a', 'img:/api/files/x'])
    expect(out).toContain('href="/a?t=1"')
    expect(out).toContain('src="/api/files/x?t=1"')
  })

  it('the share page source no longer contains an innerHTML sink', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', '..', 'app', 'share', '[token]', 'page.tsx'),
      'utf8'
    )
    expect(src).not.toMatch(/dangerouslySetInnerHTML/)
    expect(src).toMatch(/richHtmlToReact\(/)
  })
})
