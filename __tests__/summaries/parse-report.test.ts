import { parseReport } from '@/lib/summaries/parse-report'

describe('parseReport', () => {
  it('parses an English report', () => {
    const input = `## Today's Focus

- Unblock PR #42 review
- Reassign stalled AUTH task
- Ship billing fix by Friday`
    const parsed = parseReport(input, 'en')
    expect(parsed.todayFocus).toEqual([
      'Unblock PR #42 review',
      'Reassign stalled AUTH task',
      'Ship billing fix by Friday',
    ])
    expect(parsed.raw).toBe(input)
  })

  it('parses Chinese headers', () => {
    const input = `## 今日关注

- 解除 PR #42 的审核阻塞
- 重新分配 AUTH 停滞任务`
    const parsed = parseReport(input, 'zh')
    expect(parsed.todayFocus).toHaveLength(2)
  })

  it('parses Traditional Chinese headers (LUM-1121)', () => {
    const input = `## 今日焦點

- 排除 PR #42 的審查阻礙
- 重新指派 AUTH 停滯任務`
    const parsed = parseReport(input, 'zh-TW')
    expect(parsed.todayFocus).toEqual([
      '排除 PR #42 的審查阻礙',
      '重新指派 AUTH 停滯任務',
    ])
  })

  it('also accepts the character-converted Traditional heading', () => {
    const parsed = parseReport('## 今日關注\n\n- 審查 PR #42', 'zh-TW')
    expect(parsed.todayFocus).toEqual(['審查 PR #42'])
  })

  it('does not mistake another Traditional section for the focus', () => {
    const input = `## 本週風險

- 七項任務逾期`
    expect(parseReport(input, 'zh-TW').todayFocus).toEqual([])
  })

  it('tolerates asterisk bullets', () => {
    const input = `## Today's Focus

* First bullet
* Second bullet`
    const parsed = parseReport(input, 'en')
    expect(parsed.todayFocus).toEqual(['First bullet', 'Second bullet'])
  })

  it('ignores a legacy Risk section instead of surfacing it', () => {
    // Reports generated before LUM-709 still carry a "## Risk" section; it must
    // not become a parsed field, and the focus bullets still parse.
    const input = `## Today's Focus

- Unblock PR #42 review

## Risk

Project is at risk: 7/20 tasks overdue.`
    const parsed = parseReport(input, 'en')
    expect(parsed.todayFocus).toEqual(['Unblock PR #42 review'])
    expect(Object.keys(parsed).sort()).toEqual(['raw', 'todayFocus'])
  })

  it('returns empty sections for old-format report', () => {
    const input = `## Progress Overview
Some old content.

## Risks & Blockers
Some old content.`
    const parsed = parseReport(input, 'en')
    expect(parsed.todayFocus).toEqual([])
    expect(parsed.raw).toBe(input)
  })

  it('handles empty string input', () => {
    const parsed = parseReport('', 'en')
    expect(parsed.todayFocus).toEqual([])
    expect(parsed.raw).toBe('')
  })
})
