/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'
import {
  CLI_VERSION_HEADER,
  CLI_VERSION_UNSUPPORTED_CODE,
  MIN_SUPPORTED_CLI_VERSION,
  cliVersionDenied,
  parseCliVersion,
  resolveMinCliVersion,
} from '@/lib/api/cli-version-gate'

const req = (path: string, version?: string) =>
  new NextRequest(`http://localhost:3000${path}`, {
    headers: version === undefined ? {} : { [CLI_VERSION_HEADER]: version },
  })

describe('parseCliVersion', () => {
  it('accepts plain MAJOR.MINOR.PATCH and rejects anything else', () => {
    expect(parseCliVersion('1.117.0')).toEqual([1, 117, 0])
    expect(parseCliVersion(' 2.0.10 ')).toEqual([2, 0, 10])
    for (const bad of [null, undefined, '', '1.2', '1.2.3-beta', 'v1.2.3', 'x'])
      expect(parseCliVersion(bad)).toBeNull()
  })
})

describe('resolveMinCliVersion', () => {
  it('uses a valid LUMO_MIN_CLI_VERSION, else the code constant', () => {
    expect(resolveMinCliVersion({ LUMO_MIN_CLI_VERSION: '1.120.0' })).toBe(
      '1.120.0'
    )
    expect(resolveMinCliVersion({ LUMO_MIN_CLI_VERSION: 'garbage' })).toBe(
      MIN_SUPPORTED_CLI_VERSION
    )
    expect(resolveMinCliVersion({})).toBe(MIN_SUPPORTED_CLI_VERSION)
  })
})

describe('cliVersionDenied', () => {
  it('returns a structured 426 for a CLI below the minimum', async () => {
    const res = cliVersionDenied(req('/api/tasks/me', '1.117.3'), '1.120.0')
    expect(res?.status).toBe(426)
    const body = (await res!.json()) as Record<string, unknown>
    expect(body).toEqual({
      error: expect.stringContaining('lumo update'),
      code: CLI_VERSION_UNSUPPORTED_CODE,
      minVersion: '1.120.0',
      cliVersion: '1.117.3',
    })
  })

  it('lets through a CLI at or above the minimum', () => {
    expect(cliVersionDenied(req('/api/tasks', '1.120.0'), '1.120.0')).toBeNull()
    expect(cliVersionDenied(req('/api/tasks', '2.0.0'), '1.120.0')).toBeNull()
  })

  it('lets through a request without the header (older CLI, browser) or with a malformed one', () => {
    expect(cliVersionDenied(req('/api/tasks'), '9.0.0')).toBeNull()
    expect(cliVersionDenied(req('/api/tasks', 'banana'), '9.0.0')).toBeNull()
    expect(
      cliVersionDenied(req('/api/tasks', '1.0.0-rc.1'), '9.0.0')
    ).toBeNull()
  })

  it('only gates /api/ paths and does nothing without a floor', () => {
    expect(cliVersionDenied(req('/workspace', '1.0.0'), '9.0.0')).toBeNull()
    expect(cliVersionDenied(req('/api/tasks', '1.0.0'), null)).toBeNull()
  })
})
