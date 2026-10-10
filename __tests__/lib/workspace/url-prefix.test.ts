import {
  workspaceUrlPrefixFromAppUrl,
  workspaceUrlPrefixFromHost,
} from '@/lib/workspace/url-prefix'

// LUM-1028: the onboarding workspace URL prefix was hardcoded to the hosted
// domain; it is now derived from the deployment's NEXT_PUBLIC_APP_URL.
describe('workspaceUrlPrefixFromAppUrl', () => {
  it('keeps host and port for a self-hosted localhost URL', () => {
    expect(workspaceUrlPrefixFromAppUrl('http://localhost:3000')).toBe(
      'localhost:3000/workspace/'
    )
  })

  it('keeps the hosted display unchanged for https://www.uselumo.ai', () => {
    expect(workspaceUrlPrefixFromAppUrl('https://www.uselumo.ai')).toBe(
      'uselumo.ai/workspace/'
    )
  })

  it('strips trailing slashes and keeps a base path', () => {
    expect(workspaceUrlPrefixFromAppUrl('https://lumo.example.com/')).toBe(
      'lumo.example.com/workspace/'
    )
    expect(
      workspaceUrlPrefixFromAppUrl('https://example.com/lumo//?x=1#top')
    ).toBe('example.com/lumo/workspace/')
  })

  it('drops the default port and keeps a non-default one', () => {
    expect(workspaceUrlPrefixFromAppUrl('https://lumo.example.com:443')).toBe(
      'lumo.example.com/workspace/'
    )
    expect(workspaceUrlPrefixFromAppUrl('http://10.0.0.5:8080')).toBe(
      '10.0.0.5:8080/workspace/'
    )
  })

  it.each([
    undefined,
    null,
    '',
    '   ',
    'not a url',
    'localhost:3000',
    'ftp://files.example.com',
  ])('returns null for unusable value %p', value => {
    expect(workspaceUrlPrefixFromAppUrl(value)).toBeNull()
  })
})

describe('workspaceUrlPrefixFromHost', () => {
  it('builds the prefix from a browser host, dropping www.', () => {
    expect(workspaceUrlPrefixFromHost('localhost:4123')).toBe(
      'localhost:4123/workspace/'
    )
    expect(workspaceUrlPrefixFromHost('www.uselumo.ai')).toBe(
      'uselumo.ai/workspace/'
    )
  })

  it('returns null for an empty host', () => {
    expect(workspaceUrlPrefixFromHost('')).toBeNull()
  })
})
