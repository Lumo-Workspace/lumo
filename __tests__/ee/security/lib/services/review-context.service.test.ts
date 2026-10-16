/** @jest-environment node */
jest.mock('@/lib/integrations/github/contents', () => ({
  listRepoDirWithToken: jest.fn(),
  readRepoFileWithToken: jest.fn(),
  withRepoReadToken: jest.fn(),
}))

import * as gh from '@/lib/integrations/github/contents'
import { reviewContextService } from '@/ee/security/services/review-context.service'

const withToken = gh.withRepoReadToken as jest.Mock
const read = gh.readRepoFileWithToken as jest.Mock

const base = { workspaceId: 'w1', repo: 'o/r', headSha: 'sha' }

beforeEach(() => {
  jest.resetAllMocks()
  withToken.mockImplementation(
    async (_o: unknown, fn: (t: string) => Promise<unknown>) => fn('tok')
  )
  read.mockImplementation(async ({ path }: { path: string }) => `// ${path}\n`)
})

describe('LUM-988 reviewContextService.load', () => {
  it('reads every file under ONE token scope, at the head sha', async () => {
    const out = await reviewContextService.load({
      ...base,
      paths: ['a.ts', 'b.ts', 'c.ts'],
    })
    expect(withToken).toHaveBeenCalledTimes(1)
    expect(withToken.mock.calls[0]![0]).toEqual({
      workspaceId: 'w1',
      fullName: 'o/r',
    })
    expect(read).toHaveBeenCalledTimes(3)
    for (const c of read.mock.calls)
      expect(c[0]).toMatchObject({ token: 'tok', fullName: 'o/r', ref: 'sha' })
    expect(out.included).toEqual(['a.ts', 'b.ts', 'c.ts'])
    expect(out.error).toBeNull()
  })

  it('returns no context, with the reason, when the token is refused', async () => {
    withToken.mockRejectedValue(new Error('repo_not_confirmed'))
    const out = await reviewContextService.load({ ...base, paths: ['a.ts'] })
    expect(out).toEqual({ text: '', included: [], error: 'repo_not_confirmed' })
    expect(read).not.toHaveBeenCalled()
  })

  it('returns no context when a read fails, and never throws', async () => {
    read.mockRejectedValue(new Error('GitHub API error 429'))
    const out = await reviewContextService.load({ ...base, paths: ['a.ts'] })
    expect(out).toEqual({
      text: '',
      included: [],
      error: 'GitHub API error 429',
    })
  })

  it('mints nothing when there is no eligible path or no budget', async () => {
    await reviewContextService.load({ ...base, paths: [] })
    await reviewContextService.load({ ...base, paths: ['a.ts'], maxChars: 0 })
    await reviewContextService.load({
      ...base,
      paths: ['package-lock.json', 'logo.png'],
    })
    expect(withToken).not.toHaveBeenCalled()
  })

  it('packs under the given char budget', async () => {
    read.mockImplementation(async () => 'x'.repeat(400))
    const out = await reviewContextService.load({
      ...base,
      paths: ['a.ts', 'b.ts'],
      maxChars: 500,
    })
    expect(out.included).toHaveLength(1)
  })
})

describe('LUM-1208 reviewContextService.loadServerConfig', () => {
  const list = gh.listRepoDirWithToken as jest.Mock
  const plan = { triggers: ['Makefile'], dirs: ['frontend', ''], refs: [] }

  it('lists and reads at the head sha under ONE token scope', async () => {
    list.mockImplementation(async ({ path }: { path: string }) =>
      path === 'frontend' ? ['frontend/Trunk.toml'] : ['Makefile', '.env']
    )
    read.mockImplementation(async () => '[serve]\naddresses = ["0.0.0.0"]\n')
    const out = await reviewContextService.loadServerConfig({
      ...base,
      plan,
      changedPaths: ['Makefile'],
    })
    expect(withToken).toHaveBeenCalledTimes(1)
    for (const c of [...list.mock.calls, ...read.mock.calls])
      expect(c[0]).toMatchObject({ token: 'tok', fullName: 'o/r', ref: 'sha' })
    expect(out.included).toEqual(['frontend/Trunk.toml'])
    expect(out.text).toContain('0.0.0.0')
    // A real .env is never read.
    expect(read.mock.calls.map(c => c[0].path)).toEqual(['frontend/Trunk.toml'])
  })

  it('mints nothing without a trigger or a budget; a refused token is no config', async () => {
    await reviewContextService.loadServerConfig({
      ...base,
      plan: { triggers: [], dirs: [], refs: [] },
      changedPaths: [],
    })
    await reviewContextService.loadServerConfig({
      ...base,
      plan,
      changedPaths: [],
      maxChars: 0,
    })
    expect(withToken).not.toHaveBeenCalled()
    withToken.mockRejectedValue(new Error('repo_not_confirmed'))
    await expect(
      reviewContextService.loadServerConfig({ ...base, plan, changedPaths: [] })
    ).resolves.toEqual({ text: '', included: [], error: 'repo_not_confirmed' })
  })
})
