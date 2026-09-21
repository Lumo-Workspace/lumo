/**
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

import { INTEGRATIONS } from '@/lib/integrations/registry'
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

describe('landing claims LUM-804', () => {
  it('every citation resolves to a reference and every reference is cited', () => {
    const home = readLanding('lumo-home.tsx')

    const references = [...home.matchAll(/\bn:\s*(\d+),/g)].map(m =>
      Number(m[1])
    )
    const inline = [...home.matchAll(/<Cite n=\{(\d+)\}/g)].map(m =>
      Number(m[1])
    )
    const fromData = [...home.matchAll(/\bcite:\s*(\d+),/g)].map(m =>
      Number(m[1])
    )
    const cited = new Set([...inline, ...fromData])

    expect(references.length).toBeGreaterThan(0)
    expect(cited.size).toBeGreaterThan(0)

    const dangling = [...cited].filter(n => !references.includes(n)).sort()
    const orphaned = references.filter(n => !cited.has(n)).sort()

    expect({ dangling, orphaned }).toEqual({ dangling: [], orphaned: [] })
  })

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
      m[1].trim()
    )

    expect(layers.length).toBeGreaterThan(0)
    for (const layer of layers) {
      expect(Object.values(SCAN_STAGE_LABELS)).toContain(layer)
    }
  })

  it('FAQ names only integrations that exist in the registry', () => {
    const faq = readLanding('faq.tsx')
    const answers = [...faq.matchAll(/\ba: '((?:[^'\\]|\\.)*)'/g)]
      .map(m => m[1])
      .join(' ')
    expect(answers.length).toBeGreaterThan(0)

    // Display name -> registry id. Tools we do NOT integrate map to null, so
    // naming one in an answer is a failure rather than an unnoticed claim.
    const VOCABULARY: Record<string, string | null> = {
      GitHub: 'github',
      Slack: 'slack',
      Figma: 'figma',
      'Google Drive': 'googleDrive',
      Sentry: 'sentry',
      Linear: null,
      Notion: null,
      Jira: null,
      Asana: null,
    }

    const ids = new Set(Object.keys(INTEGRATIONS))
    const wrongly = Object.entries(VOCABULARY)
      .filter(([name]) => new RegExp(`\\b${name}\\b`).test(answers))
      .filter(([, id]) => id === null || !ids.has(id))
      .map(([name]) => name)

    expect(wrongly).toEqual([])
  })

  it('no surface claims a task closes itself', () => {
    const surfaces = ['lumo-home.tsx', 'faq.tsx', 'how-it-works.tsx']
      .map(readLanding)
      .map(src =>
        src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
      )

    for (const source of surfaces) {
      // The page's own rule: a machine pass moves a task to review, and a
      // person closes it. An LLM judge is the thing being replaced, not sold.
      expect(source).not.toMatch(/LLM judge/i)
      expect(source).not.toMatch(/moves the task to Verified/i)
    }
  })
})
