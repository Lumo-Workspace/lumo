/**
 * @jest-environment node
 */
/**
 * LUM-1255 — `lumo scan secrets` end to end on a real checkout: exit codes
 * (0 / 3 for --fail-on / thrown errors → 1 via the CLI wrapper) and that the
 * raw credential never reaches the output, human or JSON.
 */
import * as fs from 'fs'
import * as path from 'path'
import { scanSecretsCommand } from '../../cli/src/commands/scan-secrets'
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

describe('scanSecretsCommand', () => {
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

  const run = (opts: Parameters<typeof scanSecretsCommand>[0]) =>
    inDir(sb.main, () => captureOutput(() => scanSecretsCommand(opts)))

  it('reports findings and exits 0 without --fail-on', async () => {
    const { result, out } = await run({})
    expect(result).toBe(0)
    expect(out.split('\n')[0]).toBe('scan: 1 finding (1 high, 0 medium, 0 low)')
    expect(out).not.toContain(key)
  })

  it('exits 3 when a finding meets --fail-on', async () => {
    const { result } = await run({ failOn: 'high' })
    expect(result).toBe(EXIT_FAIL_ON)
    expect(EXIT_FAIL_ON).toBe(3)
  })

  it('exits 0 with --fail-on when nothing reaches the threshold', async () => {
    const { result, out } = await run({ failOn: 'high', staged: true })
    expect(result).toBe(0)
    expect(out.split('\n')[0]).toBe(
      'scan: 0 findings (0 high, 0 medium, 0 low)'
    )
  })

  it('--json is parseable and never carries the raw value', async () => {
    const { out } = await run({ json: true })
    expect(out).not.toContain(key)
    const json = JSON.parse(out)
    expect(json.version).toBe(1)
    expect(json.findings[0].evidence).toContain('…(len 20)')
  })

  it('rejects --staged with --since and an unknown --fail-on', async () => {
    await expect(run({ staged: true, since: 'HEAD' })).rejects.toThrow(
      /either --staged or --since/
    )
    await expect(run({ failOn: 'severe' })).rejects.toThrow(
      /--fail-on must be one of low, medium, high/
    )
  })
})
