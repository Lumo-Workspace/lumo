/**
 * @jest-environment node
 */
import { taskSlackShow } from '@/cli/src/commands/task-slack-show'

jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: () => ({
    token: 'lum_test',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  }),
}))

describe('task slack show sanitization', () => {
  const origFetch = global.fetch
  const origApiUrl = process.env.LUMO_API_URL
  let out: string
  beforeEach(() => {
    out = ''
    delete process.env.LUMO_API_URL
    jest.spyOn(console, 'log').mockImplementation((s?: unknown) => {
      out += String(s) + '\n'
    })
  })
  afterEach(() => {
    jest.restoreAllMocks()
    global.fetch = origFetch
    if (origApiUrl === undefined) delete process.env.LUMO_API_URL
    else process.env.LUMO_API_URL = origApiUrl
  })

  it('strips ESC from userName and text', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        snapshot: {
          messages: [
            { userId: 'U1', userName: 'Ev\x1bil', text: 'h\x1b[31mi' },
          ],
        },
      }),
    })) as unknown as typeof fetch

    await taskSlackShow('LUM-1', 'ctx_1')
    expect(out).not.toMatch(/\x1b/)
    expect(out).toContain('Evil: h[31mi')
  })
})
