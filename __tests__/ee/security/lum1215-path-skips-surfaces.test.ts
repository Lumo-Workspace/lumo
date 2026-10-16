/**
 * @jest-environment node
 *
 * LUM-1215 — files the path filters left out of the AI review are visible:
 * the PR summary comment and `lumo pr scan` name the files the built-in
 * defaults skipped (a few, then "and N more"), with how to include them, and
 * count the repository's own exclusions separately.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {},
}))
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_test',
    apiUrl: 'https://lumo.test',
    workspaceSlug: 'lumo',
  })),
}))

import { buildSummary } from '@/ee/security/services/security-pr-review.service'
import { pathFilterSkips } from '@/ee/security/security-scan/reviewable-path'
import {
  formatReviewPathSkips,
  REVIEW_PATH_SKIPS_MAX_NAMED,
} from '@/shared/src/security-scan'
import { formatPathSkipLines } from '@/cli/src/lib/scan-format'
import {
  formatPrScan,
  type PrScanEntry,
  type PrScanPayload,
} from '@/cli/src/commands/pr-scan'

// The production probe's shape: a Java file under build/ (source) and a
// root bundle (build output).
const PROBE = ['src/main/java/com/acme/build/Foo.java', 'dist/bundle.js']

describe('formatReviewPathSkips', () => {
  it('names the built-in skips and says how to include them', () => {
    const lines = formatReviewPathSkips(pathFilterSkips(PROBE)!)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Not AI-reviewed by default')
    expect(lines[0]).toContain('1 file — dist/bundle.js.')
    expect(lines[0]).toContain('`path_filters`')
    expect(lines[0]).toContain('`.lumo.yaml`')
    expect(lines[0]).not.toContain('Foo.java')
  })

  it('names a few, counts the rest', () => {
    const many = Array.from({ length: 12 }, (_, i) => `dist/f${i}.js`)
    const [line] = formatReviewPathSkips(pathFilterSkips(many)!)
    expect(line).toContain('12 files')
    expect(line).toContain(`and ${12 - REVIEW_PATH_SKIPS_MAX_NAMED} more`)
    expect(line).toContain('dist/f4.js')
    expect(line).not.toContain('dist/f5.js')
  })

  it("counts the repository's own exclusions on a separate line", () => {
    const lines = formatReviewPathSkips(
      pathFilterSkips(['dist/a.js', 'docs/x.md', 'docs/y.md'], ['!docs/**'])!
    )
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe(
      "Not AI-reviewed by this repository's path filters: 2 files."
    )
  })

  it('only configured skips → only the configured line', () => {
    const lines = formatReviewPathSkips({
      builtIn: { count: 0, paths: [] },
      configured: { count: 1 },
    })
    expect(lines).toEqual([
      "Not AI-reviewed by this repository's path filters: 1 file.",
    ])
  })
})

describe('PR summary comment', () => {
  const base = {
    headSha: 'abcdef1234567890',
    stages: { secrets: 'RAN', judge: 'RAN' } as never,
    status: 'CLEAN' as const,
    partial: false,
    externalCounts: {},
    open: 0,
    blocking: 0,
    error: null,
    taskUrl: null,
    repo: 'acme/app',
    prNumber: 9,
  }

  it('lists the default-skipped files as code spans', () => {
    const body = buildSummary({
      ...base,
      reviewPathSkips: pathFilterSkips(PROBE),
    })
    expect(body).toContain('- Not AI-reviewed by default')
    expect(body).toContain('`dist/bundle.js`')
    expect(body).not.toContain('Foo.java')
    // A choice of what to read, not a gap of ours.
    expect(body).toContain('No open findings on lines this PR added.')
  })

  it('a path cannot break out of its code span', () => {
    const body = buildSummary({
      ...base,
      reviewPathSkips: {
        builtIn: { count: 1, paths: ['dist/a`<b>.js'] },
        configured: { count: 0 },
      },
    })
    expect(body).toContain('`dist/ab.js`')
    expect(body).not.toContain('<b>')
  })

  it('says nothing when nothing was skipped', () => {
    expect(buildSummary({ ...base, reviewPathSkips: null })).not.toContain(
      'Not AI-reviewed'
    )
    expect(buildSummary(base)).not.toContain('Not AI-reviewed')
  })
})

describe('lumo pr scan', () => {
  it('formatPathSkipLines is terminal-safe and empty on an older server', () => {
    expect(formatPathSkipLines({})).toEqual([])
    expect(formatPathSkipLines({ reviewPathSkips: null })).toEqual([])
    const [line] = formatPathSkipLines({
      reviewPathSkips: {
        builtIn: { count: 1, paths: ['dist/\u001b[31mred.js'] },
        configured: { count: 0 },
      },
    })
    expect(line).not.toContain('\u001b')
    expect(line).toContain('red.js')
  })

  it('prints the skipped files under the scan', () => {
    const scan: PrScanEntry = {
      id: 's1',
      headSha: 'abcdef0123456789',
      status: 'CLEAN',
      trigger: 'PR_EVENT',
      judgeStatus: 'RAN',
      truncated: false,
      stages: { secrets: 'RAN', judge: 'RAN' },
      partial: false,
      externalFailureReason: null,
      startedAt: '2026-10-16T07:00:00.000Z',
      finishedAt: '2026-10-16T07:04:00.000Z',
      tokenSpent: null,
      counts: {
        findings: 0,
        open: 0,
        blocking: 0,
        dispositioned: 0,
        persisting: 0,
        externalFindings: 0,
        dependencyFindings: 0,
      },
      queueExits: {},
      findings: [],
      hunt: null,
      reviewPathSkips: pathFilterSkips(PROBE),
    }
    const data: PrScanPayload = {
      version: 1,
      pullRequest: {
        repo: 'acme/app',
        number: 9,
        title: 'probe',
        url: 'https://github.com/acme/app/pull/9',
        state: 'open',
        task: null,
      },
      scans: [scan],
      all: false,
      redactedSecrets: 0,
    }
    const out = formatPrScan(data, { width: 400, color: false })
    expect(out).toContain('Not AI-reviewed by default')
    expect(out).toContain('dist/bundle.js')
  })
})
