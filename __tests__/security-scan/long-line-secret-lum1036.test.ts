/**
 * @jest-environment node
 *
 * LUM-1036 — a secret must not be able to hide in a line longer than
 * `MAX_SCANNED_LINE_CHARS`. `scanSecrets` used to skip such a line outright,
 * so padding a key into a long line (or appending it to a minified bundle)
 * hid it from both the PR scan and the session HARDCODED_SECRET crossing.
 *
 * Synthetic secrets are assembled at runtime so this file is not itself a
 * secret-shaped write.
 */
import {
  MAX_SCANNED_LINE_CHARS,
  scanSecrets,
} from '@/lib/security-scan/scan-secrets'
import { detectCrossings } from '@/lib/services/boundary-detector.service'
import type { AddedFile } from '@/lib/security-scan/types'

const AWS_KEY = ['AK', 'IA', 'Q', 'R'.repeat(15)].join('')
const GH_TOKEN = ['gh', 'p_', 'a1B2c3D4e5'.repeat(3), 'f6G7h8I9j0'].join('')

function file(path: string, texts: string[]): AddedFile {
  return { path, lines: texts.map((text, i) => ({ lineNo: i + 1, text })) }
}

function bundle(chars: number): string {
  return `!function(){${'var a=1;'.repeat(Math.ceil(chars / 8))}}();`
}

describe('LUM-1036 scanSecrets: over-cap lines are scanned, not skipped', () => {
  it('finds a key appended past the cap of a minified line', () => {
    const line = `${bundle(MAX_SCANNED_LINE_CHARS + 500)}var k="${AWS_KEY}";`
    expect(line.length).toBeGreaterThan(MAX_SCANNED_LINE_CHARS)
    const r = scanSecrets([file('src/app.min.js', [line])])
    expect(r).toHaveLength(1)
    expect(r[0]!.ruleId).toBe('secret:aws-access-key-id')
    expect(r[0]!.severity).toBe('HIGH')
    expect(r[0]!.evidence).not.toContain(AWS_KEY)
  })

  it('finds a key buried in the middle of a very long line', () => {
    const pad = bundle(30_000)
    const line = `${pad} token=${GH_TOKEN} ${pad}`
    const r = scanSecrets([file('dist/vendor.js', [line])])
    expect(r.map(f => f.ruleId)).toEqual(['secret:github-token'])
    expect(r[0]!.evidence).not.toContain(GH_TOKEN)
  })

  it('finds a key straddling a scan-window boundary', () => {
    // The window step is cap − overlap; put the key across the first edge.
    for (const shift of [-10, -5, 0, 5]) {
      const pre = 'x'.repeat(MAX_SCANNED_LINE_CHARS + shift - 10)
      const line = `${pre} ${AWS_KEY} ${'y'.repeat(MAX_SCANNED_LINE_CHARS)}`
      const r = scanSecrets([file('src/a.js', [line])])
      expect(r.map(f => f.ruleId)).toEqual(['secret:aws-access-key-id'])
    }
  })

  it('keeps over-cap evidence bounded and redacted', () => {
    const line = `${bundle(200_000)}k="${AWS_KEY}"${bundle(200_000)}`
    const [f] = scanSecrets([file('src/app.min.js', [line])])
    expect(f).toBeDefined()
    expect(f!.evidence.length).toBeLessThan(1000)
    expect(f!.evidence).toContain('AKIA…(len 20)')
    expect(f!.evidence).not.toContain(AWS_KEY)
  })

  it('leaves an in-cap line and its evidence unchanged', () => {
    const line = `const k = "${AWS_KEY}"`
    const [f] = scanSecrets([file('src/a.ts', [line])])
    expect(f!.evidence).toBe('const k = "AKIA…(len 20)"')
  })

  it('a long secret-free line yields nothing', () => {
    expect(
      scanSecrets([file('src/app.min.js', [bundle(100_000)])])
    ).toHaveLength(0)
  })

  it('scanning a 1 MB line stays linear (well under a second)', () => {
    const line = `${bundle(1_000_000)}k="${AWS_KEY}"`
    const start = process.hrtime.bigint()
    const r = scanSecrets([file('src/app.min.js', [line])])
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    expect(r).toHaveLength(1)
    expect(ms).toBeLessThan(2000)
  })
})

describe('LUM-1036 session detector: a written over-cap line with a key is a crossing', () => {
  it('records HARDCODED_SECRET for a Write whose long line hides a key', () => {
    const content = `${bundle(MAX_SCANNED_LINE_CHARS + 100)}var k="${AWS_KEY}";\n`
    const out = detectCrossings({
      toolName: 'Write',
      filePath: 'src/app.min.js',
      payload: { tool_input: { file_path: 'src/app.min.js', content } },
    })
    expect(out.map(c => c.category)).toContain('HARDCODED_SECRET')
  })
})
