/**
 * @jest-environment node
 */
import {
  createGoogleDriveClient,
  GoogleNeedsReauthError,
} from '@/lib/integrations/google-drive/client'

const realFetch = global.fetch

function mockFetchSequence(responses: Array<() => Response>) {
  let i = 0
  global.fetch = jest.fn(async () =>
    responses[i++]!()
  ) as unknown as typeof fetch
}

afterEach(() => {
  global.fetch = realFetch
  jest.restoreAllMocks()
})

const futureTokens = {
  accessToken: 'at',
  refreshToken: 'rt',
  expiresAt: new Date(Date.now() + 3600_000),
}

describe('google drive client', () => {
  it('exports a doc as markdown', async () => {
    mockFetchSequence([() => new Response('# Title\n\nbody', { status: 200 })])
    const client = createGoogleDriveClient({
      tokens: futureTokens,
      onTokensRefreshed: async () => {},
    })
    const md = await client.exportMarkdown('fileId123')
    expect(md).toBe('# Title\n\nbody')
  })

  it('throws GoogleNeedsReauthError on a 401 that cannot be refreshed', async () => {
    mockFetchSequence([() => new Response('nope', { status: 401 })])
    const client = createGoogleDriveClient({
      tokens: { ...futureTokens, refreshToken: '' },
      onTokensRefreshed: async () => {},
    })
    await expect(client.exportMarkdown('fileId123')).rejects.toBeInstanceOf(
      GoogleNeedsReauthError
    )
  })
})
