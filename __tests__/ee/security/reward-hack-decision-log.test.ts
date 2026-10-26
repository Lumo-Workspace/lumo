/**
 * @jest-environment node
 *
 * LUM-1234 — the reward-hack layer's per-decision log line carries numbers
 * and ids only, never transcript text.
 */
import { rhDecisionLogLine } from '@/ee/security/security-scan/reward-hack-log'

describe('rhDecisionLogLine', () => {
  it('reports window, sizes and outcome without any prompt text', () => {
    const line = rhDecisionLogLine({
      scanId: 'scan_1',
      windowStart: new Date('2026-10-18T13:14:04Z'),
      windowEnd: new Date('2026-10-18T13:38:46Z'),
      sessions: 3,
      included: [{ events: [1, 2, 3] }, { events: [4] }],
      prompt: 'SECRET-TRANSCRIPT-TEXT '.repeat(10),
      truncated: false,
      outcome: 'overCap',
    })
    expect(line).toBe(
      '[reward-hack] decide scan=scan_1 window=2026-10-18T13:14:04.000Z..2026-10-18T13:38:46.000Z sessions=3 included=2 events=4 promptChars=230 estTokens=' +
        line.split('estTokens=')[1]!.split(' ')[0] +
        ' truncated=false requirementTruncated=false outcome=overCap'
    )
    expect(line).not.toContain('SECRET-TRANSCRIPT-TEXT')
    expect(Number(line.split('estTokens=')[1]!.split(' ')[0])).toBeGreaterThan(
      0
    )
  })

  it('says none when the task has no earlier merge, and zero sizes without a prompt', () => {
    const line = rhDecisionLogLine({
      scanId: 's',
      windowStart: null,
      windowEnd: new Date('2026-10-18T00:00:00Z'),
      sessions: 0,
      included: [],
      prompt: null,
      truncated: false,
      outcome: 'no-session',
    })
    expect(line).toContain('window=none..2026-10-18T00:00:00.000Z')
    expect(line).toContain('promptChars=0 estTokens=0')
    expect(line).toContain('outcome=no-session')
  })

  it('adds requirement truncation and the judge counts when known', () => {
    const line = rhDecisionLogLine({
      scanId: 's',
      windowStart: null,
      windowEnd: new Date('2026-10-18T00:00:00Z'),
      sessions: 1,
      included: [{ events: [1] }],
      prompt: 'x',
      truncated: false,
      requirementTruncated: true,
      outcome: 'judged',
      suspicion: 72,
      items: 2,
      gated: 1,
    })
    expect(line).toContain(
      'truncated=false requirementTruncated=true outcome=judged suspicion=72 items=2 gated=1'
    )
  })
})
