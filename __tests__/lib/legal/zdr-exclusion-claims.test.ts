/**
 * @jest-environment node
 *
 * LUM-871 — the ZDR manifest and the legal sources are held to two facts:
 *   1. Vercel's ZDR doc: a provider can exclude specific models or features
 *      from its ZDR policy and the AI Gateway does not fail those requests,
 *      so "fails instead of falling back" may never stand on its own.
 *   2. The committed raw probe output (scripts/analysis/lum854-zdr/
 *      probe-output.json) is the evidence for the manifest's routing table:
 *      every runtime model is in it, every row passed under ZDR, the table's
 *      "本次落点" column matches it, and it carries no credential.
 */
import * as fs from 'fs'
import * as path from 'path'

import * as models from '@/lib/ai/models'
import {
  DPA_REQUIREMENTS,
  PRIVACY_REQUIREMENTS,
  SUBPROCESSOR_REQUIREMENTS,
  ZDR_EXCLUSION_CAVEAT,
  checkRequirements,
  tableCells,
} from '../../../scripts/legal/check-legal-docs'

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const MANIFEST = read('docs/privacy/llm-data-flow.md')
const PROBE_PATH = 'scripts/analysis/lum854-zdr/probe-output.json'
const VERCEL_ZDR_DOC =
  'https://vercel.com/docs/ai-gateway/security-and-compliance/zdr'

interface ProbeRow {
  constant: string
  model: string
  kind: 'chat' | 'embedding'
  ok: boolean
  finalProvider?: string
  zdrApplied: boolean
  planningReasoning?: string
}

function probe(): { probedAt: string; rows: ProbeRow[] } {
  return JSON.parse(read(PROBE_PATH)) as {
    probedAt: string
    rows: ProbeRow[]
  }
}

/** Manifest "模型 × 实际供应商" rows: constants named in col 0, landing in col 2. */
function manifestLandings(): Map<string, string> {
  const lines = MANIFEST.split('\n')
  const start = lines.findIndex(l => l.trim().startsWith('| 模型常量'))
  expect(start).toBeGreaterThanOrEqual(0)
  const out = new Map<string, string>()
  for (const line of lines.slice(start + 2)) {
    if (!line.trim().startsWith('|')) break
    const cells = tableCells(line)
    for (const m of (cells[0] ?? '').matchAll(/`(\w+_MODEL)`/g))
      out.set(m[1]!, (cells[2] ?? '').trim())
  }
  return out
}

/** Runtime model constants the probe must cover (Jev is skipped by design). */
function probedConstants(): string[] {
  return [
    ...Object.entries(models)
      .filter(
        ([name, v]) =>
          name.endsWith('_MODEL') &&
          typeof v === 'string' &&
          v.includes('/') &&
          name !== 'CROSSING_TRIAGE_MODEL'
      )
      .map(([name]) => name),
    'EMBEDDING_MODEL',
  ].sort()
}

describe('ZDR exclusion disclosure LUM-871', () => {
  it('manifest qualifies the fail-closed claim with the Vercel exclusion caveat', () => {
    const conclusion = MANIFEST.slice(
      MANIFEST.indexOf('## 一句话结论'),
      MANIFEST.indexOf('## 怎么保证的')
    )
    expect(conclusion).toMatch(/不会降级/)
    expect(conclusion).toMatch(/排除在其 ZDR 政策之外/)
    expect(conclusion).toMatch(/不会让它失败/)

    // Caveat 10 quotes Vercel verbatim and links the doc it quotes.
    expect(MANIFEST).toContain(
      "certain models or functionalities may be excluded from a provider's ZDR policy. AI Gateway will not fail these requests if zero data retention is enabled"
    )
    expect(MANIFEST).toContain(VERCEL_ZDR_DOC)
    // The one model Vercel names as excluded is not one Lumo calls.
    expect(MANIFEST).toMatch(/anthropic\/claude-fable-5/)
    expect(Object.values(models)).not.toContain('anthropic/claude-fable-5')
  })

  it('legal sources disclose provider ZDR exclusions', () => {
    const docs: [string, typeof PRIVACY_REQUIREMENTS][] = [
      ['docs/live-docs/legal-privacy-policy.md', PRIVACY_REQUIREMENTS],
      ['docs/live-docs/legal-dpa-template.md', DPA_REQUIREMENTS],
      ['docs/live-docs/legal-subprocessors.md', SUBPROCESSOR_REQUIREMENTS],
    ]
    for (const [file, reqs] of docs) {
      const doc = read(file)
      expect([file, checkRequirements(doc, reqs)]).toEqual([file, []])
      expect(doc).toMatch(ZDR_EXCLUSION_CAVEAT)
      // Pre-LUM-871 wording, with the caveat removed, must be caught.
      const stripped = doc.replace(ZDR_EXCLUSION_CAVEAT, '')
      expect(checkRequirements(stripped, reqs)).toContain(
        'missing: provider ZDR exclusion caveat'
      )
    }
  })

  it('probe output covers every runtime model and passed under ZDR', () => {
    const { probedAt, rows } = probe()
    expect(Number.isNaN(Date.parse(probedAt))).toBe(false)
    expect(rows.map(r => r.constant).sort()).toEqual(probedConstants())
    for (const r of rows) {
      expect([r.constant, r.ok, r.zdrApplied]).toEqual([r.constant, true, true])
      expect(r.planningReasoning ?? '').toMatch(/ZDR requested/)
    }
    // The model each row probed is the one the registry exports today.
    const registry = models as unknown as Record<string, string>
    const embedding = read('lib/ai/embedding.ts').match(
      /export const EMBEDDING_MODEL = '([^']+)'/
    )?.[1]
    for (const r of rows)
      expect([r.constant, r.model]).toEqual([
        r.constant,
        r.constant === 'EMBEDDING_MODEL' ? embedding : registry[r.constant],
      ])
  })

  it('manifest landing column matches the committed probe output', () => {
    const landings = manifestLandings()
    for (const r of probe().rows)
      expect([r.constant, landings.get(r.constant)]).toEqual([
        r.constant,
        r.finalProvider,
      ])
    // The embedding landing is echoed by the gateway, not inferred.
    expect(MANIFEST).not.toMatch(/响应不回显路由/)
    expect(MANIFEST).toContain(PROBE_PATH)
  })

  it('committed probe output carries no credential', () => {
    const raw = read(PROBE_PATH)
    for (const re of [
      /authorization/i,
      /bearer\s/i,
      /api[_-]?key/i,
      /secret/i,
      /token/i,
      /\bvck_/,
      /\bsk-[A-Za-z0-9]/,
      /eyJ[A-Za-z0-9_-]{10,}/,
    ])
      expect([re.source, re.test(raw)]).toEqual([re.source, false])
  })
})
