import { parseSlackPermalink } from '@/lib/integrations/slack/parse-permalink'

describe('parseSlackPermalink', () => {
  it('parses a single-message permalink', () => {
    expect(
      parseSlackPermalink(
        'https://lumo.slack.com/archives/C01ABCDE/p1700000000000100'
      )
    ).toEqual({
      teamSubdomain: 'lumo',
      channelId: 'C01ABCDE',
      ts: '1700000000.000100',
      threadTs: undefined,
    })
  })

  it('parses a thread reply permalink', () => {
    expect(
      parseSlackPermalink(
        'https://lumo.slack.com/archives/C01ABCDE/p1700000000000200?thread_ts=1700000000.000100&cid=C01ABCDE'
      )
    ).toEqual({
      teamSubdomain: 'lumo',
      channelId: 'C01ABCDE',
      ts: '1700000000.000200',
      threadTs: '1700000000.000100',
    })
  })

  it('handles query params in any order', () => {
    expect(
      parseSlackPermalink(
        'https://lumo.slack.com/archives/C9/p1700000000000200?cid=C9&thread_ts=1700000000.000100'
      )?.threadTs
    ).toBe('1700000000.000100')
  })

  it('accepts uppercase/lowercase channel ids', () => {
    expect(
      parseSlackPermalink(
        'https://my-team.slack.com/archives/C9XYZ123/p1700000000000100'
      )?.channelId
    ).toBe('C9XYZ123')
  })

  it('preserves leading zeros in the ts micro-fraction', () => {
    // p1700000000000007 -> 1700000000.000007
    expect(
      parseSlackPermalink(
        'https://lumo.slack.com/archives/C01/p1700000000000007'
      )?.ts
    ).toBe('1700000000.000007')
  })

  it('returns null for non-Slack URLs', () => {
    expect(parseSlackPermalink('https://example.com/foo')).toBeNull()
  })

  it('returns null when the p-segment is malformed', () => {
    expect(
      parseSlackPermalink('https://lumo.slack.com/archives/C01/p123')
    ).toBeNull()
  })

  it('returns null when channel id does not start with C', () => {
    expect(
      parseSlackPermalink(
        'https://lumo.slack.com/archives/D01/p1700000000000100'
      )
    ).toBeNull()
  })

  it('returns null for empty/garbage input', () => {
    expect(parseSlackPermalink('')).toBeNull()
    expect(parseSlackPermalink('not a url')).toBeNull()
  })
})
