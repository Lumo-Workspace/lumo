/**
 * @jest-environment node
 */
import {
  FAILURE_PROMPT_THRESHOLD,
  aggregateSessionFailures,
  type SessionFailureRow,
} from '@/lib/services/session-failure-aggregate'

const at = (iso: string) => new Date(iso)

/** Build a POST_TOOL_USE_FAILURE row for the given tool. */
function toolFail(
  toolName: string | null,
  iso: string,
  payload: unknown = {}
): SessionFailureRow {
  return {
    type: 'POST_TOOL_USE_FAILURE',
    toolName,
    turnSummary: null,
    payload,
    createdAt: at(iso),
  }
}

/** Build a STOP_FAILURE row (turn-level) with an optional turnSummary. */
function turnFail(turnSummary: string | null, iso: string): SessionFailureRow {
  return {
    type: 'STOP_FAILURE',
    toolName: null,
    turnSummary,
    payload: {},
    createdAt: at(iso),
  }
}

describe('FAILURE_PROMPT_THRESHOLD', () => {
  it('is 3 (same-type failures repeated ≥3 times)', () => {
    expect(FAILURE_PROMPT_THRESHOLD).toBe(3)
  })
})

describe('aggregateSessionFailures', () => {
  it('returns null when there are no failures', () => {
    expect(aggregateSessionFailures([])).toBeNull()
  })

  it('groups POST_TOOL_USE_FAILURE by toolName and returns the top group', () => {
    const rows = [
      toolFail('Bash', '2026-06-01T10:00:00.000Z'),
      toolFail('Bash', '2026-06-01T10:01:00.000Z'),
      toolFail('Edit', '2026-06-01T10:02:00.000Z'),
      toolFail('Bash', '2026-06-01T10:03:00.000Z'),
    ]
    const top = aggregateSessionFailures(rows)
    expect(top).not.toBeNull()
    expect(top!.label).toBe('Bash')
    expect(top!.count).toBe(3)
  })

  it('does not mix different tools into one group', () => {
    const rows = [
      toolFail('Bash', '2026-06-01T10:00:00.000Z'),
      toolFail('Edit', '2026-06-01T10:01:00.000Z'),
      toolFail('Read', '2026-06-01T10:02:00.000Z'),
    ]
    const top = aggregateSessionFailures(rows)
    // 3 distinct tools, each count 1 → top group count is 1
    expect(top!.count).toBe(1)
  })

  it('groups all STOP_FAILURE turns under a single turn key', () => {
    const rows = [
      turnFail('卡在测试', '2026-06-01T10:00:00.000Z'),
      turnFail('又卡在测试', '2026-06-01T10:01:00.000Z'),
      turnFail('还是测试', '2026-06-01T10:02:00.000Z'),
    ]
    const top = aggregateSessionFailures(rows)
    expect(top!.count).toBe(3)
  })

  it('uses the most recent row in the top group for lastErrorSummary (turnSummary preferred)', () => {
    const rows = [
      turnFail('旧的错误', '2026-06-01T10:00:00.000Z'),
      turnFail('最新的错误', '2026-06-01T10:05:00.000Z'),
      turnFail('中间的错误', '2026-06-01T10:02:00.000Z'),
    ]
    const top = aggregateSessionFailures(rows)
    expect(top!.lastErrorSummary).toBe('最新的错误')
  })

  it('extracts an error summary from POST_TOOL_USE_FAILURE payload when no turnSummary', () => {
    const rows = [
      toolFail('Bash', '2026-06-01T10:00:00.000Z', {
        tool_response: { stderr: 'command not found: foo' },
      }),
      toolFail('Bash', '2026-06-01T10:01:00.000Z', {
        tool_response: { stderr: 'command not found: bar' },
      }),
      toolFail('Bash', '2026-06-01T10:02:00.000Z', {
        tool_response: { stderr: 'command not found: baz' },
      }),
    ]
    const top = aggregateSessionFailures(rows)
    expect(top!.lastErrorSummary).toContain('command not found: baz')
  })

  it('truncates a long error summary', () => {
    const long = 'x'.repeat(500)
    const rows = [
      toolFail('Bash', '2026-06-01T10:00:00.000Z', { tool_response: long }),
      toolFail('Bash', '2026-06-01T10:01:00.000Z', { tool_response: long }),
      toolFail('Bash', '2026-06-01T10:02:00.000Z', { tool_response: long }),
    ]
    const top = aggregateSessionFailures(rows)
    expect(top!.lastErrorSummary!.length).toBeLessThanOrEqual(160)
  })

  it('falls back to null lastErrorSummary when nothing extractable', () => {
    const rows = [
      toolFail('Bash', '2026-06-01T10:00:00.000Z', {}),
      toolFail('Bash', '2026-06-01T10:01:00.000Z', {}),
      toolFail('Bash', '2026-06-01T10:02:00.000Z', {}),
    ]
    const top = aggregateSessionFailures(rows)
    expect(top!.lastErrorSummary).toBeNull()
  })

  it('tie-breaks toward the group whose most recent failure is newest', () => {
    const rows = [
      toolFail('Bash', '2026-06-01T10:00:00.000Z'),
      toolFail('Bash', '2026-06-01T10:01:00.000Z'),
      toolFail('Edit', '2026-06-01T10:02:00.000Z'),
      toolFail('Edit', '2026-06-01T10:09:00.000Z'),
    ]
    // Both have count 2; Edit's most recent (10:09) is newer than Bash's (10:01)
    const top = aggregateSessionFailures(rows)
    expect(top!.label).toBe('Edit')
  })
})
