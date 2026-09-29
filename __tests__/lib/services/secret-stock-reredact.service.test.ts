/**
 * @jest-environment node
 *
 * LUM-898: a stored value is re-redacted with today's registry exactly the
 * way new data is — and a value that is already clean (whatever key order
 * jsonb hands back) is never rewritten.
 */
import {
  assertApplyHost,
  planStockRowRewrite,
  reredactStoredValue,
} from '@/lib/services/secret-stock-reredact.service'
import {
  classifyRow,
  classifyStoredText,
} from '../../../scripts/analysis/lum887-secret-stock/classify'
import { buildPrunedPayload } from '@/lib/hook-event/retention'

// Built by concatenation so no credential-shaped literal sits in the repo.
const AWS_KEY = ['AKIA', 'ZXCVBNMLKJHGFDSA'].join('')
const ENV_LINE = 'DB_PASSWORD=' + 'Qm7Tz4Lw' + '9Kp2'
const DASHES = '-'.repeat(5)
const KEY_LINES = [
  `${DASHES}BEGIN RSA PRIVATE KEY${DASHES}`,
  'Qm7Tz4Lw9Kp2Xc8V'.repeat(4),
  'Xc8VQm7Tz4Lw9Kp2'.repeat(4),
  `${DASHES}END RSA PRIVATE KEY${DASHES}`,
]

const COMMENT = { delegate: 'comment' }
const ACTIVITY = { delegate: 'taskActivity' }
const HOOK = { delegate: 'hookEvent' }

/** Reverse key order at every level, the way jsonb may hand a row back. */
function reorder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorder)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([k, v]) => [k, reorder(v)])
    )
  }
  return value
}

describe('reredactStoredValue', () => {
  it('LUM-898 stock rewrite clears every credential shape and is idempotent', () => {
    // Text column (Comment.body): shapes redacted, prose kept.
    const body = `Deploy notes\nkey ${AWS_KEY}\n${ENV_LINE}\nthanks`
    const text = reredactStoredValue(COMMENT, 'body', body)!
    expect(text.secrets).toBeGreaterThanOrEqual(2)
    expect(typeof text.value).toBe('string')
    expect(classifyStoredText(text.value as string).size).toBe(0)
    expect(text.value).toContain('Deploy notes')
    expect(text.value).toContain('thanks')
    expect(reredactStoredValue(COMMENT, 'body', text.value)).toBeNull()

    // JSON column (TaskActivity.payload): nested string + a key stored one
    // line per array element; no hook marker is stamped on it.
    const payload = {
      kind: 'NOTE',
      detail: { note: `pasted ${AWS_KEY}` },
      lines: KEY_LINES,
    }
    expect(classifyRow([payload]).size).toBeGreaterThan(0)
    const json = reredactStoredValue(ACTIVITY, 'payload', payload)!
    expect(classifyRow([json.value]).size).toBe(0)
    const out = json.value as Record<string, unknown>
    expect(out.kind).toBe('NOTE')
    expect(out).not.toHaveProperty('_lumo_redaction')
    expect(JSON.stringify(out)).not.toContain(KEY_LINES[1])
    expect(
      reredactStoredValue(ACTIVITY, 'payload', reorder(json.value))
    ).toBeNull()

    // HookEvent.payload stored before LUM-887: earlier markers survive and the
    // redaction count accumulates.
    const hook = {
      tool_name: 'Bash',
      tool_input: { command: `export ${ENV_LINE}` },
      _lumo_redaction: { count: 2 },
      _lumo_redacted: { 'tool_input.content': { lines: 3, bytes: 90 } },
    }
    const h = reredactStoredValue(HOOK, 'payload', hook)!
    const hp = h.value as Record<string, unknown>
    expect(classifyRow([hp]).size).toBe(0)
    expect(hp._lumo_redaction).toEqual({ count: 2 + h.secrets })
    expect(hp._lumo_redacted).toEqual(hook._lumo_redacted)
    expect(hook.tool_input.command).toContain(ENV_LINE) // input not mutated
    expect(reredactStoredValue(HOOK, 'payload', reorder(hp))).toBeNull()

    // A row plans only its dirty columns.
    const plan = planStockRowRewrite(
      { label: 'Comment', delegate: 'comment', fields: ['body', 'title'] },
      { id: 'c1', body, title: 'fine' }
    )!
    expect(plan.columns.map(c => c.field)).toEqual(['body'])
    expect(plan.columns[0]!.before).toBe(body)
  })

  it('LUM-898 stock rewrite leaves clean rows and reordered json untouched', () => {
    expect(reredactStoredValue(COMMENT, 'body', 'ship it tomorrow')).toBeNull()
    expect(reredactStoredValue(COMMENT, 'body', null)).toBeNull()
    // Already-redacted text is not redacted again.
    const once = reredactStoredValue(COMMENT, 'body', `k ${AWS_KEY}`)!.value
    expect(reredactStoredValue(COMMENT, 'body', once)).toBeNull()

    const clean = {
      z: 1,
      a: { y: ['one', 'two'], b: 'plain text' },
      _lumo_redaction: { count: 4 },
    }
    expect(reredactStoredValue(ACTIVITY, 'payload', reorder(clean))).toBeNull()
    expect(reredactStoredValue(HOOK, 'payload', reorder(clean))).toBeNull()
    // A pruned hook payload is left as the retention sweep wrote it.
    const pruned = buildPrunedPayload(new Date(), 30 as never)
    expect(reredactStoredValue(HOOK, 'payload', pruned)).toBeNull()

    expect(
      planStockRowRewrite(
        { label: 'Task', delegate: 'task', fields: ['title', 'claimSnapshot'] },
        { id: 't1', title: 'Add login', claimSnapshot: reorder(clean) }
      )
    ).toBeNull()
  })
})

describe('assertApplyHost', () => {
  it('returns the host only when the operator named it', () => {
    const url = 'postgres://u:p@db.example.test:5432/lumo'
    expect(assertApplyHost(url, 'db.example.test:5432')).toBe(
      'db.example.test:5432'
    )
    expect(() => assertApplyHost(url, 'other.host')).toThrow(/confirm-host/)
    expect(() => assertApplyHost(url, undefined)).toThrow(/confirm-host/)
  })
})
