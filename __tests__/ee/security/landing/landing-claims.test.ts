/**
 * LUM-1064: plugin half of __tests__/landing/landing-claims.test.ts (split)
 *
 * LUM-804 — drift guards for the factual claims the landing page makes.
 *
 * The landing page is a marketing fork with no runtime coupling to the code it
 * describes, so nothing stops a claim on it from quietly going stale: a scan
 * layer gets renamed, an integration is dropped, a figure loses its citation.
 * Each of these had already happened before this task (the FAQ named Linear and
 * Notion as integrations for months; a stat carried no reference entry at all).
 *
 * These tests read the landing sources as text on purpose. They are asserting
 * on the rendered *claims*, not on an exported API — importing the components
 * would test React, not the sentences.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  HOOK_EVENT_RETENTION_DAYS,
  USED_UP_GRACE_DAYS,
} from '@/lib/hook-event/retention'
import { DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS } from '@/ee/security/security-scan/evidence-retention'
import { SCAN_STAGE_LABELS } from '@/shared/src/security-scan'

const LANDING_DIR = join(process.cwd(), 'components', 'landing', 'home')

function readLanding(file: string): string {
  return readFileSync(join(LANDING_DIR, file), 'utf8')
}

/** The body of a top-level `const <name> = [ … ]` block, comments stripped. */
function arrayLiteral(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = [`)
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('\n]\n', start)
  expect(end).toBeGreaterThan(start)
  return source
    .slice(start, end)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * LUM-804 scan-layer cases (moved from the core landing test in LUM-1035):
 * the Security card and the scan FAQ entry are plugin copy — the open-source
 * snapshot cuts them (oss/manifest.json transforms) — so they are checked
 * where the plugin is.
 */
describe('landing scan claims LUM-804 (plugin side)', () => {
  it('copy that counts the scan layers agrees with SCAN_STAGE_LABELS', () => {
    const labels = Object.values(SCAN_STAGE_LABELS)
    const COUNT_WORD: Record<number, string> = {
      3: 'three',
      4: 'four',
      5: 'five',
      6: 'six',
      7: 'seven',
    }
    const word = COUNT_WORD[labels.length]
    expect(word).toBeDefined()

    // Both the Security card and the FAQ spell the layer count out in prose.
    // Add a sixth layer and these sentences silently become wrong, which is
    // exactly the drift this guard exists to catch.
    for (const file of ['lumo-home.tsx', 'faq.tsx']) {
      const prose = readLanding(file)
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
      if (!/\b\w+ layers before it merges/.test(prose)) continue

      expect(prose).toMatch(new RegExp(`${word} layers before it merges`))
      for (const stem of [
        'secrets',
        'code scan',
        'dependencies',
        'AI review',
      ]) {
        expect(prose).toContain(stem)
      }
      expect(prose).toMatch(/exploit path/)
    }
  })

  it('security findings list only names layers the scan actually has', () => {
    const block = arrayLiteral(readLanding('lumo-home.tsx'), 'SCAN_FINDINGS')
    const layers = [...block.matchAll(/meta: '([^·']+)·/g)].map(m =>
      (m[1] ?? '').trim()
    )

    expect(layers.length).toBeGreaterThan(0)
    for (const layer of layers) {
      expect(Object.values(SCAN_STAGE_LABELS)).toContain(layer)
    }
  })
})

/**
 * LUM-915 — the FAQ's retention sentences quote the defaults and tiers the
 * settings rows and cleanup sweeps run on.
 */
describe('FAQ retention claims LUM-915', () => {
  function privacyAnswer(): string {
    const m = readLanding('faq.tsx').match(
      /q: 'Do you train on our code\?',\s*a: '((?:[^'\\]|\\.)*)'/
    )
    expect(m).not.toBeNull()
    return (m as RegExpMatchArray)[1] as string
  }

  /** "30, 90, 180 or 365": the FAQ's own list style. */
  function orList(days: readonly number[]): string {
    const all = days.map(String)
    return `${all.slice(0, -1).join(', ')} or ${all[all.length - 1]}`
  }

  it('FAQ retention sentences quote the shipped retention constants', () => {
    const answer = privacyAnswer()
    expect(answer).toContain('Agent session records are kept by default')
    expect(answer).toContain(
      `cleared after ${orList(HOOK_EVENT_RETENTION_DAYS)} days`
    )
    expect(answer).toContain(
      `discarded ${USED_UP_GRACE_DAYS} days after the work is used up`
    )
    expect(answer).toContain(
      `cleared ${DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS} days after its pull request is merged or closed`
    )
  })
})

/**
 * LUM-871 (moved from the core landing test in LUM-1065, with the client it
 * reads): the FAQ names boundary-crossing triage as the one request outside
 * the ZDR layer — true only while the evaluation client skips `zdr-fetch`.
 */
describe('FAQ privacy claims LUM-871 (plugin side)', () => {
  it('the crossing-triage evaluation client really bypasses the ZDR layer', () => {
    const src = readFileSync(
      join(process.cwd(), 'ee', 'security', 'ai', 'evaluation.ts'),
      'utf8'
    )
    expect(src).not.toMatch(/zdr-fetch/)
    // LUM-871 (moved from the core landing test in LUM-1035): triage is the
    // one request outside the ZDR layer, so the ZDR sentence must name it.
    expect(readLanding('faq.tsx')).toMatch(
      /zero data retention enforced on the request itself for all but boundary-crossing triage/
    )
    expect(readLanding('faq.tsx')).toMatch(/does not offer zero data retention/)
  })
})
