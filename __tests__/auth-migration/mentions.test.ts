/**
 * @jest-environment node
 *
 * LUM-1072 — rekey rewrites user @mentions only.
 */
import { rewriteUserMentions } from '@/lib/auth-migration/mentions'
import { parseMentionedUserClerkIds } from '@/lib/editor/parse-mentions'

const MAP = new Map([['user_old1', 'user_new1']])

describe('LUM-1072 rewriteUserMentions', () => {
  it('rewrites typed and legacy (untyped) user mentions, leaves everything else', () => {
    const html =
      '<p>hi <span class="mention" data-mention-type="user" data-id="user_old1">@A</span> ' +
      '<a class="x mention" data-id="user_old1">@A</a> ' +
      '<span class="mention" data-mention-type="task" data-id="user_old1">#T</span> ' +
      '<span class="other" data-id="user_old1">x</span> user_old1 ' +
      '<span class="mention" data-id="user_other">@B</span></p>'
    const { html: out, replaced } = rewriteUserMentions(html, MAP)
    expect(replaced).toBe(2)
    expect(parseMentionedUserClerkIds(out, '')).toEqual([
      'user_new1',
      'user_other',
    ])
    // Task mention, non-mention element and plain text untouched.
    expect(out).toContain('data-mention-type="task" data-id="user_old1"')
    expect(out).toContain('<span class="other" data-id="user_old1">')
    expect(out).toContain(' user_old1 ')
  })

  it('is a no-op without matching ids', () => {
    const html = '<span class="mention" data-id="user_x">@X</span>'
    expect(rewriteUserMentions(html, MAP)).toEqual({ html, replaced: 0 })
  })
})
