/**
 * @jest-environment node
 *
 * LUM-1335 — `LUMO_MODE`: opt-in, fails loudly on an unknown value.
 */
import {
  isLocalMode,
  isLocalModeOnPublicUrl,
  isLoopbackHost,
  resolveLumoMode,
} from '@/lib/auth/local-mode'

describe('resolveLumoMode', () => {
  it('unset or blank is the normal sign-in', () => {
    expect(resolveLumoMode({})).toBe('standard')
    expect(resolveLumoMode({ LUMO_MODE: '  ' })).toBe('standard')
  })

  it('local, in any case and with spaces', () => {
    expect(resolveLumoMode({ LUMO_MODE: ' Local ' })).toBe('local')
    expect(isLocalMode({ LUMO_MODE: 'local' })).toBe(true)
    expect(isLocalMode({})).toBe(false)
  })

  it('an unknown value throws naming the variable, never guessing', () => {
    expect(() => resolveLumoMode({ LUMO_MODE: 'demo' })).toThrow(
      /LUMO_MODE "demo"/
    )
    expect(() => isLocalMode({ LUMO_MODE: 'true' })).toThrow(/LUMO_MODE/)
  })
})

describe('isLoopbackHost', () => {
  it.each(['localhost', 'app.localhost', '127.0.0.1', '127.1.2.3', '[::1]'])(
    '%s is this machine',
    host => expect(isLoopbackHost(host)).toBe(true)
  )
  it.each([
    'lumo.example.com',
    '192.168.1.20',
    '0.0.0.0',
    'localhost.example.com',
  ])('%s is reachable from elsewhere', host =>
    expect(isLoopbackHost(host)).toBe(false)
  )
})

describe('isLocalModeOnPublicUrl', () => {
  const local = { LUMO_MODE: 'local' }
  it('only local mode on a non-loopback URL', () => {
    expect(isLocalModeOnPublicUrl('https://lumo.example.com', local)).toBe(true)
    expect(isLocalModeOnPublicUrl('http://localhost:3000', local)).toBe(false)
    expect(isLocalModeOnPublicUrl('https://lumo.example.com', {})).toBe(false)
    expect(isLocalModeOnPublicUrl(undefined, local)).toBe(false)
    expect(isLocalModeOnPublicUrl('not a url', local)).toBe(false)
  })
})
