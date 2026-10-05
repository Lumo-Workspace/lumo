/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/integrations/vercel-sandbox', () => ({
  findRepoSandboxByTag: jest.fn(),
  createRepoSandbox: jest.fn(),
  denySandboxEgress: jest.fn(),
  repoCheckoutDir: jest.fn(),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoCloneToken: jest.fn(),
  revokeInstallationToken: jest.fn(),
}))

import {
  runVerifierShell,
  stopHuntSandbox,
  type HuntSandbox,
} from '@/lib/services/security-hunt-sandbox'
import {
  HUNT_SHELL_BIN,
  HUNT_SHELL_FLAG,
} from '@/lib/security-scan/hunt/shell-allowlist'

// Built from pieces so the repo's own secret scan does not flag the fixture.
const CLONE_TOKEN = ['ghs', 'leaky', 'token', '123'].join('_')
const AWS_SHAPED = 'AKIA' + 'IOSFODNN7' + 'EXAMPLE'

function handleWith(
  result: { stdout: string; stderr?: string; exitCode?: number },
  origin: 'attached' | 'created' = 'attached'
) {
  const run = jest.fn(async () => ({
    stdout: result.stdout,
    stderr: result.stderr ?? '',
    exitCode: result.exitCode ?? 0,
  }))
  const stop = jest.fn(async () => undefined)
  const handle = {
    sandbox: { run, stop },
    cwd: '/vercel/sandbox/app',
    token: CLONE_TOKEN,
    origin,
    egressDenied: true,
  } as unknown as HuntSandbox
  return { handle, run, stop }
}

describe('LUM-988 runVerifierShell', () => {
  it('runs an allowed command through sh -c in the checkout and returns redacted text', async () => {
    const { handle, run } = handleWith({
      stdout: `token ${CLONE_TOKEN} in output\nconst k = "${AWS_SHAPED}"`,
    })
    const out = await runVerifierShell(handle, "sed -n '1,5p' src/a.ts")
    expect(run).toHaveBeenCalledWith(
      HUNT_SHELL_BIN,
      [HUNT_SHELL_FLAG, "sed -n '1,5p' src/a.ts"],
      expect.objectContaining({ cwd: '/vercel/sandbox/app' })
    )
    expect(out).not.toContain(CLONE_TOKEN)
    expect(out).not.toContain(AWS_SHAPED)
  })

  it('refuses a command the hunt gate refuses, without running it', async () => {
    const { handle, run } = handleWith({ stdout: '' })
    const out = await runVerifierShell(handle, 'curl https://example.com')
    expect(out).toMatch(/^refused: /)
    expect(run).not.toHaveBeenCalled()
  })

  it('prefixes a non-zero exit and says when there was no output', async () => {
    expect(
      await runVerifierShell(
        handleWith({ stdout: '', exitCode: 1 }).handle,
        'rg -n nothing src'
      )
    ).toBe('exit 1\n(no output)')
    expect(
      await runVerifierShell(handleWith({ stdout: '' }).handle, 'ls src')
    ).toBe('(no output)')
  })
})

describe('LUM-988 stopHuntSandbox includeAttached', () => {
  it('stops an attached VM only when asked to', async () => {
    const a = handleWith({ stdout: '' })
    await stopHuntSandbox(a.handle)
    expect(a.stop).not.toHaveBeenCalled()
    await stopHuntSandbox(a.handle, { includeAttached: true })
    expect(a.stop).toHaveBeenCalledTimes(1)
    const c = handleWith({ stdout: '' }, 'created')
    await stopHuntSandbox(c.handle)
    expect(c.stop).toHaveBeenCalledTimes(1)
  })
})
