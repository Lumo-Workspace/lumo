/**
 * @jest-environment node
 *
 * LUM-1146 — the PR summary reports how `.lumo.yaml` was read: an invalid
 * file (and the fallback to the Lumo settings) is never silent, unknown keys
 * are listed, a PR that changes the file is told when it applies, and a
 * file applied cleanly is named in the footer. Untrusted text stays inert.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {},
}))

import { buildSummary } from '@/ee/security/services/security-pr-review.service'
import type { RepoConfigNotice } from '@/ee/security/security-scan/repo-config'

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

const file = (over: object = {}) => ({
  status: 'loaded' as const,
  sha: 'a'.repeat(40),
  problems: [],
  unknownKeys: [],
  ...over,
})

describe('summary: .lumo.yaml', () => {
  it('says nothing when the scan did not read it or there is no file', () => {
    expect(buildSummary(base)).not.toContain('.lumo.yaml')
    expect(
      buildSummary({
        ...base,
        repoConfig: {
          baseRef: 'main',
          base: file({ status: 'absent' }),
          prBranch: null,
        },
      })
    ).not.toContain('.lumo.yaml')
  })

  it('a clean file is named in the footer only', () => {
    const body = buildSummary({
      ...base,
      repoConfig: { baseRef: 'main', base: file(), prBranch: null },
    })
    expect(body).toContain('Reviewed commit: abcdef1 · Settings: `.lumo.yaml`')
    expect(body.match(/\.lumo\.yaml/g)).toHaveLength(1)
  })

  it('an invalid base file is a notice naming the fallback', () => {
    const notice: RepoConfigNotice = {
      baseRef: 'main',
      base: file({
        status: 'invalid',
        problems: ['line 2, reviews.path_filters: expected array'],
      }),
      prBranch: null,
    }
    const body = buildSummary({ ...base, repoConfig: notice })
    expect(body).toContain(
      "- `.lumo.yaml` on the base branch `main` is invalid and was not applied: this PR was reviewed with the repository's settings in Lumo. Problems: `line 2, reviews.path_filters: expected array`."
    )
    expect(body).not.toContain('Settings: `.lumo.yaml`')
  })

  it('keeps untrusted keys inert (no markup, no mention outside a code span)', () => {
    const body = buildSummary({
      ...base,
      repoConfig: {
        baseRef: 'main<script>',
        base: file({ unknownKeys: ['@org/team`<img>'] }),
        prBranch: null,
      },
    })
    expect(body).not.toContain('<img>')
    expect(body).not.toContain('<script>')
    expect(body).toContain('`@org/teamimg`')
  })

  it('a PR that changes the file is told it applies after merge', () => {
    const body = buildSummary({
      ...base,
      repoConfig: {
        baseRef: 'main',
        base: file({ status: 'absent' }),
        prBranch: file({ status: 'invalid', problems: ['line 1: bad indent'] }),
      },
    })
    expect(body).toContain(
      'This PR changes `.lumo.yaml` and the new file is invalid'
    )
    expect(body).toContain('applies to reviews after this PR merges')
  })
})
