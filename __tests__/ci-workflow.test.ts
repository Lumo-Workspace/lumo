/**
 * @jest-environment node
 *
 * LUM-837 — Lumo's own CI runs on GitHub Actions like a customer's, on every
 * push to a PR. Guards the two things that silently break it: job names the
 * gate map no longer recognises (the run would produce no gate signal), and
 * the runaway guards that were missing in the LUM-735 incident (7 stuck runs
 * burned the month's free minutes) — the per-job timeout and per-PR
 * cancel-in-progress.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifyGateName } from '../shared/src/gate-map'

const workflow = readFileSync(
  join(process.cwd(), '.github/workflows/ci.yml'),
  'utf8'
)

describe('ci.yml (LUM-837)', () => {
  it('lumo ci workflow jobs classify as the typecheck and test gates', () => {
    const names = [...workflow.matchAll(/^ {4}name: (\S+)$/gm)].map(m => m[1])
    expect(names).toEqual(['typecheck', 'test'])
    expect(names.map(n => classifyGateName(n!))).toEqual(['typecheck', 'test'])
  })

  it('lumo ci workflow runs on every pull request push with runaway guards', () => {
    expect(workflow).toMatch(
      /on:\n {2}pull_request:\n {4}types: \[opened, synchronize, reopened\]\n/
    )
    // PR events only: no push / schedule trigger doubling the bill.
    expect(workflow).not.toMatch(/^ {2}push:/m)
    expect(workflow).not.toMatch(/^ {2}schedule:/m)
    expect(workflow.match(/^ {4}timeout-minutes: 20$/gm)).toHaveLength(2)
    expect(workflow).toMatch(
      /concurrency:\n {2}group: ci-\$\{\{ github\.event\.pull_request\.number \}\}\n {2}cancel-in-progress: true/
    )
  })
})
