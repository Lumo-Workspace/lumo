/** @jest-environment node */

jest.mock('dns/promises', () => ({
  lookup: jest.fn(),
}))

import { lookup } from 'dns/promises'
import { assertExternalHost } from '@/lib/integrations/og-metadata/ssrf'

const lookupMock = lookup as unknown as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('assertExternalHost', () => {
  it('allows a public IPv4 host', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    await expect(
      assertExternalHost('https://example.com/foo')
    ).resolves.toBeUndefined()
  })

  it('allows a public IPv6 host', async () => {
    lookupMock.mockResolvedValue([
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ])
    await expect(
      assertExternalHost('https://example.com/foo')
    ).resolves.toBeUndefined()
  })

  it.each([
    ['IPv4 loopback', '127.0.0.1'],
    ['IPv4 private 10/8', '10.0.0.5'],
    ['IPv4 private 172.16/12', '172.16.99.1'],
    ['IPv4 private 192.168/16', '192.168.1.1'],
    ['IPv4 link-local 169.254/16', '169.254.169.254'],
    ['IPv4 multicast', '224.0.0.1'],
    ['IPv4 reserved 0/8', '0.0.0.5'],
  ])('rejects %s', async (_label, ip) => {
    lookupMock.mockResolvedValue([{ address: ip, family: 4 }])
    await expect(assertExternalHost('https://x.test/')).rejects.toThrow(
      /host not allowed/
    )
  })

  it.each([
    ['IPv6 loopback', '::1'],
    ['IPv6 link-local fe80::/10', 'fe80::1'],
    ['IPv6 unique-local fc00::/7', 'fc00::1'],
    ['IPv6 multicast ff00::/8', 'ff01::1'],
  ])('rejects %s', async (_label, ip) => {
    lookupMock.mockResolvedValue([{ address: ip, family: 6 }])
    await expect(assertExternalHost('https://x.test/')).rejects.toThrow(
      /host not allowed/
    )
  })

  it('rejects IPv4-mapped IPv6 that maps to a private IPv4', async () => {
    // 10.0.0.1 expressed as ::ffff:10.0.0.1
    lookupMock.mockResolvedValue([{ address: '::ffff:10.0.0.1', family: 6 }])
    await expect(assertExternalHost('https://x.test/')).rejects.toThrow(
      /host not allowed/
    )
  })

  it('rejects when ANY resolved address is private (even if one is public)', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ])
    await expect(assertExternalHost('https://example.com/')).rejects.toThrow(
      /host not allowed/
    )
  })

  it('throws on malformed URL', async () => {
    await expect(assertExternalHost('not a url')).rejects.toThrow()
    expect(lookupMock).not.toHaveBeenCalled()
  })
})
