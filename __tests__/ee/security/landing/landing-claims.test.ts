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
import { DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS } from '@/lib/security-scan/evidence-retention'

const LANDING_DIR = join(process.cwd(), 'components', 'landing', 'home')

function readLanding(file: string): string {
  return readFileSync(join(LANDING_DIR, file), 'utf8')
}

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
