/**
 * @jest-environment node
 *
 * LUM-928 — Slack mrkdwn escaping helpers.
 */
import { escapeMrkdwn, mrkdwnLink } from '@/lib/integrations/slack/mrkdwn'

describe('escapeMrkdwn', () => {
  it('escapes the three Slack control characters, ampersand first', () => {
    expect(escapeMrkdwn('<!channel> & <@U1> &amp;')).toBe(
      '&lt;!channel&gt; &amp; &lt;@U1&gt; &amp;amp;'
    )
  })

  it('leaves other text and numbers unchanged', () => {
    expect(escapeMrkdwn('Fix *login* — "v2" | _ok_')).toBe(
      'Fix *login* — "v2" | _ok_'
    )
    expect(escapeMrkdwn(42)).toBe('42')
  })
})

describe('mrkdwnLink', () => {
  it('builds one link with an escaped label', () => {
    expect(mrkdwnLink('https://github.com/a/b/pull/1', '#1 <!here>')).toBe(
      '<https://github.com/a/b/pull/1|#1 &lt;!here&gt;>'
    )
  })

  it('stops the URL from closing the link or adding a label', () => {
    expect(mrkdwnLink('https://x.test/?a=1&b=2|evil><!channel>', 'ok')).toBe(
      '<https://x.test/?a=1&amp;b=2%7Cevil&gt;&lt;!channel&gt;|ok>'
    )
  })
})
