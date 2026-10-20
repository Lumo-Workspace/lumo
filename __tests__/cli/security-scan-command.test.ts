/**
 * @jest-environment node
 */
/**
 * LUM-1255 — `lumo security scan` end to end on a real checkout: scanner
 * selection, exit codes (0 / 2 usage / 3 for --fail-on; a thrown failure is
 * 1 via the CLI wrapper) and that the raw credential never reaches the
 * output, human or JSON.
 */
import * as fs from 'fs'
import * as path from 'path'
import {
  securityScanCommand,
  selectScanners,
} from '../../cli/src/commands/security-scan'
import { EXIT_USAGE } from '../../cli/src/lib/exit-codes'
import { EXIT_FAIL_ON } from '../../cli/src/lib/local-scan-report'
import {
  captureOutput,
  git,
  inDir,
  isolateGitEnv,
  makeSandbox,
  type Sandbox,
} from '../../cli/test-support/real-git'
import { fakeAwsKeyId } from '../../cli/test-support/fake-secrets'

describe('selectScanners', () => {
  it('runs every local scanner when no scanner flag is given', () => {
    expect(selectScanners({})).toEqual(['SECRETS', 'DEPS'])
  })

  it('runs the flagged scanners', () => {
    expect(selectScanners({ secrets: true })).toEqual(['SECRETS'])
    expect(selectScanners({ deps: true })).toEqual(['DEPS'])
    expect(selectScanners({ secrets: true, deps: true })).toEqual([
      'SECRETS',
      'DEPS',
    ])
  })
})

describe('securityScanCommand', () => {
  let restore: () => void
  let sb: Sandbox
  const key = fakeAwsKeyId()

  beforeAll(() => {
    restore = isolateGitEnv()
  })
  afterAll(() => restore())

  beforeEach(() => {
    sb = makeSandbox('main')
    git(sb.main, 'checkout', '-q', '-b', 'feature')
    fs.writeFileSync(
      path.join(sb.main, 'config.ts'),
      `export const awsKey = "${key}"\n`
    )
  })
  afterEach(() => sb.cleanup())

  const run = (opts: Parameters<typeof securityScanCommand>[0]) =>
    inDir(sb.main, () => captureOutput(() => securityScanCommand(opts)))

  it('reports findings and exits 0 without --fail-on', async () => {
    const { result, out } = await run({})
    expect(result).toBe(0)
    expect(out.split('\n')[0]).toBe('scan: 1 finding (1 high, 0 medium, 0 low)')
    expect(out).toContain('Scope: SECRETS, DEPS · ')
    // No lockfile in the change: DEPS makes no lookup and says so.
    expect(out).toContain(
      'Deps: no added or changed package in an npm lockfile'
    )
    expect(out).not.toContain(key)
  })

  it('exits 3 when a finding meets --fail-on', async () => {
    const { result } = await run({ secrets: true, failOn: 'high' })
    expect(EXIT_FAIL_ON).toBe(3)
    expect(result).toBe(EXIT_FAIL_ON)
  })

  it('exits 0 with --fail-on when nothing reaches the threshold', async () => {
    const { result, out } = await run({ failOn: 'high', staged: true })
    expect(result).toBe(0)
    expect(out.split('\n')[0]).toBe(
      'scan: 0 findings (0 high, 0 medium, 0 low)'
    )
  })

  it('--json is the list envelope and never carries the raw value', async () => {
    const { out } = await run({ json: true })
    expect(out).not.toContain(key)
    const json = JSON.parse(out)
    expect(json).toMatchObject({
      version: 1,
      total: 1,
      nextCursor: null,
      scanners: ['SECRETS', 'DEPS'],
      summary: { total: 1, high: 1, medium: 0, low: 0 },
      complete: true,
      incomplete: [],
    })
    expect(json.findings[0]).toMatchObject({
      scanner: 'SECRETS',
      ruleId: 'secret:aws-access-key-id',
      downgrade: null,
    })
    expect(json.findings[0].evidence).toContain('…(len 20)')
  })

  it('usage mistakes exit 2 with an Error line', async () => {
    const both = await run({ staged: true, since: 'HEAD' })
    expect(both.result).toBe(EXIT_USAGE)
    expect(both.err).toMatch(/^Error: pass either --staged or --since/)
    const bad = await run({ failOn: 'severe' })
    expect(bad.result).toBe(EXIT_USAGE)
    expect(bad.err).toMatch(
      /invalid --fail-on "severe" \(allowed: low, medium, high, done\)/
    )
  })
})
