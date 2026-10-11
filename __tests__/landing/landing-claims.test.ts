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
// LUM-1064: plugin cases live in __tests__/ee/security/landing/landing-claims.test.ts
// (LUM-1035 moved the scan-layer and crossing-triage ZDR cases there too: the
// open-source snapshot cuts that copy from the landing page).
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  HOOK_EVENT_RETENTION_DAYS,
  USED_UP_GRACE_DAYS,
} from '@/lib/hook-event/retention'
import { INTEGRATIONS } from '@/lib/integrations/registry'

const LANDING_DIR = join(process.cwd(), 'components', 'landing', 'home')

function readLanding(file: string): string {
  return readFileSync(join(LANDING_DIR, file), 'utf8')
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

/**
 * LUM-853 — the FAQ privacy answer is held to shipped code, the same way the
 * /security page and the privacy policy are. Constants are read from source
 * text (not imported) so these guards never load Prisma or the AI SDK.
 */
describe('FAQ privacy claims LUM-853', () => {
  const ROOT = process.cwd()
  const readRoot = (path: string) => readFileSync(join(ROOT, path), 'utf8')

  function privacyAnswer(): string {
    const faq = readLanding('faq.tsx')
    const m = faq.match(
      /q: 'Do you train on our code\?',\s*a: '((?:[^'\\]|\\.)*)'/
    )
    expect(m).not.toBeNull()
    return (m as RegExpMatchArray)[1] as string
  }

  function exportKinds(): string[] {
    const src = readRoot('lib/repositories/workspace-export.repository.ts')
    const block = src.slice(
      src.indexOf('export const EXPORT_KINDS = ['),
      src.indexOf('] as const')
    )
    return [...block.matchAll(/'([a-z-]+)'/g)].map(m => m[1] as string)
  }

  it('FAQ privacy answer makes no unbacked claim', () => {
    const answer = privacyAnswer()

    // The pre-LUM-853 overclaims: export is partial, access is per workspace.
    expect(answer).not.toMatch(/everything on demand/i)
    expect(answer).not.toMatch(/export (or delete )?everything/i)
    expect(answer).not.toMatch(/scoped per team/i)
    // AI processing is routed globally: no region may be promised.
    expect(answer).not.toMatch(
      /\b(EU|Europe|European|United States|US-only|us-east|in your region)\b/
    )
    // Not shipped (LUM-863: storage relies on at-rest encryption only), so
    // not claimed.
    expect(answer).not.toMatch(/separate key|per-workspace key|own key/i)
    // LUM-915: discarding session records is an owner's opt-in, not the
    // default, and code is stored by default — so nothing may say it is
    // never stored or deleted right after use.
    expect(answer).not.toMatch(/deleted (right )?after use|never stored/i)
    for (const sentence of answer.split(/(?<=\.)\s+/)) {
      if (/discard/i.test(sentence))
        expect(sentence).toMatch(/a workspace owner can/)
    }
    expect(answer).not.toMatch(/full record/i)
    // Encryption is scoped to what lib/crypto.ts encrypts: connected-tool tokens.
    for (const sentence of answer.split(/(?<=\.)\s+/)) {
      if (/encrypt/i.test(sentence)) expect(sentence).toMatch(/^Tokens /)
    }
  })

  it('FAQ privacy answer states the shipped guarantees', () => {
    const answer = privacyAnswer()

    // No training + zero data retention, forced on every gateway request.
    expect(answer).toMatch(/Neither Lumo nor the model hosts we use train/)
    expect(answer).toMatch(/zero data retention enforced/)
    expect(readRoot('lib/ai/zdr-fetch.ts')).toMatch(
      /ZDR_GATEWAY_OPTIONS = \{ zeroDataRetention: true \}/
    )
    // LUM-871's exception (boundary-crossing triage runs outside the ZDR
    // layer) is plugin copy: the FAQ names it only while the security plugin
    // ships, so it is asserted in
    // __tests__/ee/security/landing/landing-claims.test.ts (LUM-1035). The
    // open-source snapshot drops that clause (oss/manifest.json transform).
    expect(answer).toMatch(/zero data retention enforced on the request itself/)
    // Team wording rule for processing location.
    expect(answer).toMatch(/routed globally/)
    expect(answer).toMatch(/don’t promise a processing region/)
    expect(answer).toMatch(/AES-256-GCM/)

    // Export names only kinds the archive really carries.
    const kinds = new Set(exportKinds())
    const NAMED: Record<string, string> = {
      projects: 'projects',
      tasks: 'tasks',
      documents: 'documents',
      'team memory': 'memories',
    }
    const exportSentence =
      answer.split(/(?<=\.)\s+/).find(s => /export/.test(s)) ?? ''
    expect(exportSentence).toMatch(/workspace owner can download an export/)
    for (const [phrase, kind] of Object.entries(NAMED)) {
      expect(exportSentence).toContain(phrase)
      expect(kinds.has(kind)).toBe(true)
    }

    // Deletion waits the real grace window before the purge.
    expect(readRoot('lib/services/workspace-deletion.service.ts')).toMatch(
      /WORKSPACE_DELETION_GRACE_MS = 48 \* 60 \* 60 \* 1000/
    )
    expect(answer).toMatch(/any owner can cancel within 48 hours/)
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

  // LUM-1064: the scan-evidence sentence is plugin copy and is checked in the
  // ee half; the session-record sentences are core and are checked here too.
  it('FAQ retention sentences quote the shipped session-record constants', () => {
    const answer = privacyAnswer()
    expect(answer).toContain('Agent session records are kept by default')
    expect(answer).toContain(
      `cleared after ${orList(HOOK_EVENT_RETENTION_DAYS)} days`
    )
    expect(answer).toContain(
      `discarded ${USED_UP_GRACE_DAYS} days after the work is used up`
    )
  })
})
