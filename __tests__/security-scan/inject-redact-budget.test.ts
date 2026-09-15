/**
 * @jest-environment node
 *
 * LUM-784 criterion 3 — the injection redaction sits on the hottest path
 * Lumo has (every session start, every hunt step), so its cost has a stated
 * ceiling and this test holds it.
 *
 * The payload is shaped like a heavy session start: a memory index plus the
 * seven linked sections (Slack, web, Figma, artifacts, docs, comments, PRs)
 * with mostly ordinary prose, a sprinkling of secrets, and a few over-cap
 * lines (a minified bundle pasted into a comment). ≥ 64 KB, ≥ 1500 lines —
 * several times what the 25k-token output budget lets a real session start
 * carry, so the bound is conservative for production.
 *
 * The bound is wall-clock and deliberately loose (a CI runner under load is
 * still a runner): what it catches is a regression in *kind* — a pattern
 * with catastrophic backtracking, an accidental O(n²) join, a per-line
 * allocation storm — not a 10 % slowdown.
 */
import {
  MAX_SCANNED_LINE_CHARS,
  redactForInjection,
} from '@/lib/security-scan/scan-secrets'
import { guardInjectedText } from '@/lib/security-scan/inject-guard'

/** Upper bound for one full session-start-sized redaction, in ms. */
export const SESSION_START_REDACTION_BUDGET_MS = 250
const MIN_BYTES = 64 * 1024
const MIN_LINES = 1500

function buildPayload(): string {
  const prose = [
    '- [project · agent-authored] **Session model uses many-to-one to a single task.** → All session work records under the final task only.',
    '  Workaround: Split session on task switch, or add task array to session instead of single FK.',
    '- kai: he said "let\'s ship it tomorrow"; the password reset flow and the token budget are both fine.',
    '  > Fetched OG description: A project management tool for small dev teams — Next.js 14, Prisma, Clerk.',
    '- [external:github] PR #1008 feat: content-level injection guard at every untrusted injection point [LUM-783]',
    '  ↳ body: lumo task web show LUM-784 wl_abc123 · postgres://user@host/db (no password here)',
    '中文评论：这条线程讨论了 secret 的脱敏口径，token 与 password 这些词本身不是命中。',
  ]
  const secrets = [
    'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'const k = "AKIAABCDEFGHIJKLMNOP"',
    'DATABASE_URL="postgres://lumo:hunter2secret@db.example.com:5432/app"',
    'SLACK=xoxb-123456789012-abcdefghijkl',
  ]
  const lines: string[] = ['## Relevant Memory', '', '### Traps', '']
  let i = 0
  while (lines.length < MIN_LINES || lines.join('\n').length < MIN_BYTES) {
    lines.push(prose[i % prose.length]!)
    if (i % 40 === 0) lines.push(secrets[(i / 40) % secrets.length]!)
    // A pasted minified bundle every ~300 lines: over the cap, with a secret
    // sitting past it so the cut is exercised too.
    if (i % 300 === 150) {
      lines.push(
        `!function(){${'var a=1;'.repeat(MAX_SCANNED_LINE_CHARS / 8 + 10)}}(); key=AIzaSyAbcdefghijklmnopqrstuvwxyz0123456`
      )
    }
    i++
  }
  return lines.join('\n')
}

function timed(fn: () => void): number {
  const start = process.hrtime.bigint()
  fn()
  return Number(process.hrtime.bigint() - start) / 1e6
}

describe('LUM-784 hot-path budget', () => {
  const payload = buildPayload()

  it('the payload is session-start sized', () => {
    expect(Buffer.byteLength(payload, 'utf8')).toBeGreaterThanOrEqual(MIN_BYTES)
    expect(payload.split('\n').length).toBeGreaterThanOrEqual(MIN_LINES)
  })

  it(`redactForInjection over the whole payload stays under ${SESSION_START_REDACTION_BUDGET_MS} ms`, () => {
    // Warm-up: JIT and regex compilation are not what the budget measures.
    redactForInjection(payload)
    const runs = [1, 2, 3].map(() => timed(() => redactForInjection(payload)))
    const best = Math.min(...runs)
    expect(best).toBeLessThan(SESSION_START_REDACTION_BUDGET_MS)
    const r = redactForInjection(payload)
    expect(r.redactedCount).toBeGreaterThan(0)
    expect(r.truncatedLines).toBeGreaterThan(0)
    expect(r.text).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(r.text).not.toContain('AIzaSyAbcdefghijklmnopqrstuvwxyz0123456')
  })

  it(`the full redact+guard chain (what a wrapper runs) stays under ${SESSION_START_REDACTION_BUDGET_MS} ms`, () => {
    guardInjectedText(payload)
    const runs = [1, 2, 3].map(() => timed(() => guardInjectedText(payload)))
    expect(Math.min(...runs)).toBeLessThan(SESSION_START_REDACTION_BUDGET_MS)
  })

  it('a clean payload of the same size pays only the scan (no copy)', () => {
    const clean = payload
      .split('\n')
      .filter(l => l.length <= MAX_SCANNED_LINE_CHARS)
      .filter(l => !/ghp_|AKIA|hunter2secret|xoxb-|AIza/.test(l))
      .join('\n')
    expect(clean.length).toBeGreaterThan(MIN_BYTES / 2)
    const r = redactForInjection(clean)
    expect(r.text).toBe(clean)
    const runs = [1, 2, 3].map(() => timed(() => redactForInjection(clean)))
    expect(Math.min(...runs)).toBeLessThan(SESSION_START_REDACTION_BUDGET_MS)
  })
})
