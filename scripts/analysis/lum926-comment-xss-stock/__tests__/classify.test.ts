/** @jest-environment node */
import { classifyCommentBody, commentSource } from '../classify'
import { sanitizeCommentHtml } from '@/lib/html/sanitize-comment-html'
import { HEADER_MARKER_OPEN } from '@/lib/integrations/github/markdown-bridge'

const hits = (body: string) => [...classifyCommentBody(body)].sort()

describe('LUM-926 comment stock classifier', () => {
  it('classifies risky comment body patterns', () => {
    expect(hits('<img src=x onerror=alert(1)>')).toEqual(['event-handler'])
    expect(hits('<p ONCLICK="x()">hi</p>')).toEqual(['event-handler'])
    expect(hits('<div/onmouseover="x()">')).toEqual(['event-handler'])
    expect(hits('<SCRIPT>alert(1)</SCRIPT>')).toEqual(['script'])
    expect(hits('<a href="javascript:alert(1)">x</a>')).toEqual([
      'javascript-url',
    ])
    expect(hits("<a href=' JavaScript:alert(1)'>x</a>")).toEqual([
      'javascript-url',
    ])
    expect(hits('<svg onload=alert(1)>')).toEqual(['event-handler', 'svg'])
    expect(hits('<iframe src="https://x"></iframe>')).toEqual(['iframe'])

    // Benign: escaped markup, prose, and the sanitizer's own output.
    expect(hits('<p>online=true and svg files</p>')).toEqual([])
    expect(hits('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')).toEqual([])
    expect(hits('<p>see javascript: the good parts</p>')).toEqual([])
    expect(
      hits(
        sanitizeCommentHtml(
          '<img src=x onerror=alert(1)><script>x</script><a href="javascript:x">a</a><svg></svg><iframe></iframe>'
        )
      )
    ).toEqual([])
    expect(hits('')).toEqual([])
  })

  it('splits sources by idea id and the inbound mirror header', () => {
    expect(commentSource({ ideaId: 'i1', body: 'x' })).toBe('idea')
    expect(
      commentSource({ ideaId: null, body: `${HEADER_MARKER_OPEN}x` })
    ).toBe('task-pr-mirror-inbound')
    expect(commentSource({ ideaId: null, body: '<p>x</p>' })).toBe('task-lumo')
  })
})
