/**
 * @jest-environment node
 *
 * LUM-855 backfill: the per-row rewrite is the ingest pipeline (credential
 * redaction + code stripping) applied to a stored row — and must be a no-op on
 * a row that pipeline already produced, whatever key order jsonb returns.
 */
import {
  canonicalJson,
  rewriteStoredPayload,
} from '@/lib/services/hook-event-code-backfill.service'
import { stripCodeFromHookPayload } from '@/lib/hook-payload/redact'
import { redactHookPayload } from '@/lib/validation/hook-payload'
import { buildPrunedPayload } from '@/lib/hook-event/retention'

// Built by concatenation so no credential-shaped literal sits in the repo.
const FAKE_KEY = ['AKIA', 'ZXCVBNMLKJHGFDSA'].join('')
const CODE = `export const key = "${FAKE_KEY}"\nexport const x = compute()\n`

const rawWrite = () => ({
  session_id: 's1',
  tool_name: 'Write',
  tool_input: { file_path: '/repo/lib/a.ts', content: CODE },
  tool_response: { type: 'create', filePath: '/repo/lib/a.ts', content: CODE },
})

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

describe('rewriteStoredPayload', () => {
  it('rewrites a raw historical row into the ingest shape', () => {
    const out = rewriteStoredPayload('POST_TOOL_USE', rawWrite())!
    expect(out).not.toBeNull()
    const text = JSON.stringify(out.payload)
    expect(text).not.toContain('compute()')
    expect(text).not.toContain(FAKE_KEY)
    expect(out.payload.tool_input).toEqual({ file_path: '/repo/lib/a.ts' })
    expect(out.secrets).toBe(2)

    // A realistic file body: the stored row shrinks to paths + stats.
    const big = rewriteStoredPayload('POST_TOOL_USE', {
      tool_name: 'Write',
      tool_input: {
        file_path: '/repo/lib/b.ts',
        content: 'x = 1\n'.repeat(500),
      },
    })!
    expect(big.bytesAfter).toBeLessThan(big.bytesBefore / 5)
  })

  it('backfill rewrite is a no-op on a row already in the ingest shape', () => {
    const ingested = stripCodeFromHookPayload(
      'POST_TOOL_USE',
      redactHookPayload(rawWrite()).payload
    )
    expect(rewriteStoredPayload('POST_TOOL_USE', ingested as never)).toBeNull()
    // jsonb returns keys in its own order — still a no-op.
    expect(
      rewriteStoredPayload('POST_TOOL_USE', reorder(ingested) as never)
    ).toBeNull()
    // Running the backfill output through again changes nothing either.
    const once = rewriteStoredPayload('POST_TOOL_BATCH', {
      tool_calls: [rawWrite()],
    })!
    expect(
      rewriteStoredPayload('POST_TOOL_BATCH', reorder(once.payload) as never)
    ).toBeNull()
  })

  it('keeps the stats a partly stripped row already carries', () => {
    // A POST_TOOL_BATCH row stored between the #1129 and #1130 deploys: its
    // top level was never stripped, but give it a prior marker to merge.
    const prior = { 'tool_input.content': { bytes: 1, lines: 1, sha256: 'x' } }
    const out = rewriteStoredPayload('POST_TOOL_BATCH', {
      _lumo_redacted: prior,
      tool_calls: [rawWrite()],
    })!
    const marker = out.payload._lumo_redacted as Record<string, unknown>
    expect(marker['tool_input.content']).toEqual(prior['tool_input.content'])
    expect(marker['tool_calls.0.tool_input.content']).toBeDefined()
  })

  it('leaves pruned, non-object and conversation-only rows alone', () => {
    expect(
      rewriteStoredPayload('POST_TOOL_USE', {
        ...buildPrunedPayload(new Date('2026-09-01T00:00:00Z'), 30),
      } as never)
    ).toBeNull()
    expect(rewriteStoredPayload('POST_TOOL_USE', null)).toBeNull()
    expect(rewriteStoredPayload('POST_TOOL_USE', ['x'] as never)).toBeNull()
    expect(
      rewriteStoredPayload('PRE_TOOL_USE', {
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
      })
    ).toBeNull()
  })

  it('canonicalJson ignores key order at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { f: 1, e: 2 }], c: 2 } })).toBe(
      canonicalJson({ a: { c: 2, d: [1, { e: 2, f: 1 }] }, b: 1 })
    )
  })
})
