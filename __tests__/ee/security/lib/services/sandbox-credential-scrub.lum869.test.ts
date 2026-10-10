/** @jest-environment node */
/**
 * LUM-869 — git's `http.extraheader` carries the token base64-encoded
 * (`AUTHORIZATION: basic <base64("x-access-token:" + token)>`), where a plain
 * `.includes(token)` never sees it.
 */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))

import {
  carriesToken,
  scrubSandboxCredentials,
} from '@/ee/security/services/sandbox-credential-scrub'

const TOKEN = 'fake-scoped-clone-token-'.repeat(2)
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')
const CLEAN_CONFIG = '[remote "origin"]\n\turl = https://github.com/o/r.git\n'

function vm(files: Record<string, string>, env = 'HOME=/vercel\n') {
  return {
    name: 'vm',
    cwd: '/vercel',
    run: jest.fn(async (cmd: string) => ({
      exitCode: 0,
      stdout: cmd === 'env' ? env : '',
      stderr: '',
    })),
    readFile: jest.fn(async (path: string) =>
      path in files ? Buffer.from(files[path]!) : null
    ),
    stop: jest.fn(),
  }
}

describe('LUM-869 base64 token detection', () => {
  it('LUM-869 scrub detects a base64 encoded token', async () => {
    // Every prefix alignment, in the exact shape git writes. base64 works
    // in 3-byte groups, so the token starts at one of three offsets inside
    // a group: prefix length mod 3 = 0, 1 or 2 (LUM-876 — 2 was missing).
    const prefixes = [
      'x-access-token:',
      ':',
      'ab:',
      '',
      'a:',
      'x-access-token:ab',
    ]
    expect(new Set(prefixes.map(p => p.length % 3))).toEqual(new Set([0, 1, 2]))
    for (const prefix of prefixes) {
      const header = `AUTHORIZATION: basic ${b64(prefix + TOKEN)}`
      expect(carriesToken(header, TOKEN)).toBe(true)
    }
    expect(carriesToken(CLEAN_CONFIG, TOKEN)).toBe(false)
    expect(
      carriesToken(`AUTHORIZATION: basic ${b64('x-access-token:other')}`, TOKEN)
    ).toBe(false)

    // A global .gitconfig with the base64 header: refused, fail-closed.
    const header = `[http]\n\textraheader = AUTHORIZATION: basic ${b64(`x-access-token:${TOKEN}`)}\n`
    const home = vm({
      '/vercel/r/.git/config': CLEAN_CONFIG,
      '/vercel/.gitconfig': header,
    })
    await expect(
      scrubSandboxCredentials(
        { sandbox: home as never, cwd: '/vercel/r', token: TOKEN },
        'o/r',
        { waitMs: 0, pollMs: 1 }
      )
    ).rejects.toThrow(/readable at \/vercel\/.gitconfig/)

    // In the command environment: refused too.
    const env = vm(
      { '/vercel/r/.git/config': CLEAN_CONFIG },
      `HOME=/vercel\nGIT_HEADER=${b64(`x-access-token:${TOKEN}`)}\n`
    )
    await expect(
      scrubSandboxCredentials(
        { sandbox: env as never, cwd: '/vercel/r', token: TOKEN },
        'o/r',
        { waitMs: 0, pollMs: 1 }
      )
    ).rejects.toThrow(/command environment/)

    // In the checkout's own config: the local extraheader is unset and the
    // config is re-read — one that still carries it is refused.
    const local = vm({
      '/vercel/r/.git/config': `${CLEAN_CONFIG}${header}`,
    })
    await expect(
      scrubSandboxCredentials(
        { sandbox: local as never, cwd: '/vercel/r', token: TOKEN },
        'o/r',
        { waitMs: 0, pollMs: 1 }
      )
    ).rejects.toThrow(/still reachable/)
    expect(local.run).toHaveBeenCalledWith(
      'git',
      ['config', '--local', '--unset-all', 'http.extraheader'],
      expect.anything()
    )
  })
})
