import { parseReport } from '@/lib/summaries/parse-report'

describe('parseReport', () => {
  it('parses a full English two-section report', () => {
    const input = `## Today's Focus

- Unblock PR #42 review
- Reassign stalled AUTH task
- Ship billing fix by Friday

## Risk

Project is at risk: 7/20 tasks overdue and 3 stalled tasks blocking the team.`
    const parsed = parseReport(input, 'en')
    expect(parsed.todayFocus).toEqual([
      'Unblock PR #42 review',
      'Reassign stalled AUTH task',
      'Ship billing fix by Friday',
    ])
    expect(parsed.riskNarrative).toContain('7/20 tasks overdue')
    expect(parsed.raw).toBe(input)
  })

  it('parses Chinese headers', () => {
    const input = `## 今日关注

- 解除 PR #42 的审核阻塞
- 重新分配 AUTH 停滞任务

## 风险

项目处于关注状态:5/20 任务逾期。`
    const parsed = parseReport(input, 'zh')
    expect(parsed.todayFocus).toHaveLength(2)
    expect(parsed.riskNarrative).toContain('5/20 任务逾期')
  })

  it('tolerates asterisk bullets', () => {
    const input = `## Today's Focus

* First bullet
* Second bullet

## Risk

No blockers detected.`
    const parsed = parseReport(input, 'en')
    expect(parsed.todayFocus).toEqual(['First bullet', 'Second bullet'])
  })

  it('returns empty sections for old-format report', () => {
    const input = `## Progress Overview
Some old content.

## Risks & Blockers
Some old content.`
    const parsed = parseReport(input, 'en')
    expect(parsed.todayFocus).toEqual([])
    expect(parsed.riskNarrative).toBe('')
    expect(parsed.raw).toBe(input)
  })

  it('handles missing Risk section gracefully', () => {
    const input = `## Today's Focus

- Only one bullet`
    const parsed = parseReport(input, 'en')
    expect(parsed.todayFocus).toEqual(['Only one bullet'])
    expect(parsed.riskNarrative).toBe('')
  })

  it('handles empty string input', () => {
    const parsed = parseReport('', 'en')
    expect(parsed.todayFocus).toEqual([])
    expect(parsed.riskNarrative).toBe('')
    expect(parsed.raw).toBe('')
  })
})
