/**
 * @jest-environment node
 *
 * LUM-1129 — the security summary names the PR comment commands (with the
 * configured handle) when they are on, and keeps the CLI-only wording when
 * they are not.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {},
}))

import {
  buildSummary,
  commandsBlock,
} from '@/ee/security/services/security-pr-review.service'

const base = {
  headSha: 'abcdef1234567890',
  stages: { secrets: 'RAN', judge: 'PAUSED' } as never,
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

describe('summary: PR comment commands', () => {
  test('with a handle: a folded commands block and the paused notice names the comment commands', () => {
    const body = buildSummary({ ...base, commandHandle: '@uselumo' })
    expect(body).toContain(commandsBlock('@uselumo'))
    expect(body).toContain(
      'Comment `@uselumo review` for an incremental review'
    )
    expect(body).toContain(
      'CLI: `lumo pr review 9 --repo acme/app` (Lumo CLI 1.125 and older: `lumo pr scan 9 --repo acme/app --review incremental`)'
    )
  })

  test('without a handle: no commands block, CLI wording unchanged', () => {
    const body = buildSummary(base)
    expect(body).not.toContain('Lumo commands')
    expect(body).toContain(
      'Request an incremental review with `lumo pr review 9 --repo acme/app` (Lumo CLI 1.125 and older: `lumo pr scan 9 --repo acme/app --review incremental`)'
    )
  })

  test('the block lists every command', () => {
    const block = commandsBlock('@uselumo')
    for (const c of ['review', 'full review', 'pause', 'resume', 'resolve'])
      expect(block).toContain(`\`@uselumo ${c}\``)
  })
})

test('LUM-1130: `approve` is listed only where the request-changes workflow is on', () => {
  expect(commandsBlock('@uselumo')).not.toContain('`@uselumo approve`')
  expect(commandsBlock('@uselumo', true)).toContain('`@uselumo approve`')
  expect(
    buildSummary({ ...base, commandHandle: '@uselumo', approveCommand: true })
  ).toContain('`@uselumo approve`')
})
