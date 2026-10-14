/**
 * @jest-environment node
 *
 * LUM-1136 — the latest published Lumo CLI version, fail-soft to null.
 */
import { fetchLatestCliVersion } from '@/lib/cli/latest-version'

const respond = (status: number, body: unknown) =>
  jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch

describe('fetchLatestCliVersion', () => {
  it('reads the npm dist-tag latest for @lumoai/cli with an hourly cache', async () => {
    const f = respond(200, { version: '1.122.0' })
    expect(await fetchLatestCliVersion(f)).toBe('1.122.0')
    const [url, init] = (f as unknown as jest.Mock).mock.calls[0]
    expect(url).toBe('https://registry.npmjs.org/@lumoai/cli/latest')
    expect(init.next).toEqual({ revalidate: 3600 })
  })

  it('null on a non-2xx response', async () => {
    expect(await fetchLatestCliVersion(respond(503, {}))).toBeNull()
  })

  it('null on a malformed version', async () => {
    expect(
      await fetchLatestCliVersion(respond(200, { version: '<b>1</b>' }))
    ).toBeNull()
  })

  it('null when fetch throws (network down / timeout)', async () => {
    const f = jest.fn().mockRejectedValue(new Error('timeout'))
    expect(await fetchLatestCliVersion(f as unknown as typeof fetch)).toBeNull()
  })
})
