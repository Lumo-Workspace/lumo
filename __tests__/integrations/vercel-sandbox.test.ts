/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))

// `@vercel/sandbox` is mapped to __stubs__/vercel-sandbox.ts by jest.config.js.
import { Sandbox } from '@vercel/sandbox'
import { logger } from '@/lib/logger'
import {
  createRepoSandbox,
  stopRepoSandboxesByTag,
} from '@/lib/integrations/vercel-sandbox'

const create = Sandbox.create as jest.Mock
const list = Sandbox.list as jest.Mock
const get = Sandbox.get as jest.Mock

function asyncIterable<T>(items: T[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const i of items) yield i
    },
  }
}

beforeEach(() => jest.clearAllMocks())

describe('createRepoSandbox (LUM-745 tags)', () => {
  it('passes tags through to Sandbox.create and omits the key when none are given', async () => {
    create.mockResolvedValue({ cwd: '/vercel' })
    await createRepoSandbox({
      repository: 'o/r',
      revision: 'a'.repeat(40),
      token: 't',
      timeoutMs: 1000,
      vcpus: 2,
      tags: { lumoScan: 's1' },
    })
    expect(create.mock.calls[0][0]).toEqual(
      expect.objectContaining({ tags: { lumoScan: 's1' } })
    )
    await createRepoSandbox({
      repository: 'o/r',
      revision: 'a'.repeat(40),
      token: 't',
      timeoutMs: 1000,
      vcpus: 2,
    })
    expect(create.mock.calls[1][0]).not.toHaveProperty('tags')
  })
})

describe('stopRepoSandboxesByTag', () => {
  it('stops every pending/running sandbox under the tag and skips finished ones', async () => {
    list.mockResolvedValue(
      asyncIterable([
        { name: 'a', status: 'running' },
        { name: 'b', status: 'stopped' },
        { name: 'c', status: 'pending' },
      ])
    )
    const stopA = jest.fn(async () => ({}))
    const stopC = jest.fn(async () => ({}))
    get.mockImplementation(async ({ name }: { name: string }) =>
      name === 'a' ? { stop: stopA } : { stop: stopC }
    )
    await expect(stopRepoSandboxesByTag({ lumoScan: 's1' })).resolves.toBe(2)
    expect(list).toHaveBeenCalledWith({ tags: { lumoScan: 's1' } })
    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenCalledWith({ name: 'a' })
    expect(get).toHaveBeenCalledWith({ name: 'c' })
    expect(stopA).toHaveBeenCalled()
    expect(stopC).toHaveBeenCalled()
  })

  it('a sandbox that fails to stop is logged and skipped; the rest still stop', async () => {
    list.mockResolvedValue(
      asyncIterable([
        { name: 'a', status: 'running' },
        { name: 'b', status: 'running' },
      ])
    )
    get.mockImplementation(async ({ name }: { name: string }) =>
      name === 'a'
        ? {
            stop: jest.fn(async () => {
              throw new Error('gone')
            }),
          }
        : { stop: jest.fn(async () => ({})) }
    )
    await expect(stopRepoSandboxesByTag({ lumoScan: 's1' })).resolves.toBe(1)
    const line = (logger.warn as jest.Mock).mock.calls[0]?.join(' ') ?? ''
    expect(line).toContain('name=a')
    expect(line).toContain('gone')
  })

  it('returns 0 when nothing carries the tag', async () => {
    list.mockResolvedValue(asyncIterable([]))
    await expect(stopRepoSandboxesByTag({ lumoScan: 'none' })).resolves.toBe(0)
    expect(get).not.toHaveBeenCalled()
  })
})

describe('getRepoSandbox (LUM-746 reconnect)', () => {
  it('reconnects by name and exposes the same run/readFile/stop surface plus env/timeoutMs on run', async () => {
    const runCommand = jest.fn().mockResolvedValue({
      exitCode: 3,
      stdout: async () => 'out',
      stderr: async () => 'err',
    })
    const stop = jest.fn()
    get.mockResolvedValue({ name: 'sb-1', cwd: '/vercel', runCommand, stop })
    const { getRepoSandbox } = await import('@/lib/integrations/vercel-sandbox')
    const sandbox = await getRepoSandbox({ name: 'sb-1' })
    expect(get).toHaveBeenCalledWith({ name: 'sb-1' })
    expect(sandbox.name).toBe('sb-1')
    expect(sandbox.cwd).toBe('/vercel')
    const result = await sandbox.run('sh', ['-c', 'true'], {
      cwd: '/vercel/lumo',
      env: { CI: 'true' },
      timeoutMs: 5000,
    })
    expect(runCommand).toHaveBeenCalledWith({
      cmd: 'sh',
      args: ['-c', 'true'],
      cwd: '/vercel/lumo',
      env: { CI: 'true' },
      timeoutMs: 5000,
    })
    expect(result).toEqual({ exitCode: 3, stdout: 'out', stderr: 'err' })
    await sandbox.stop()
    expect(stop).toHaveBeenCalled()
  })

  it('createRepoSandbox exposes the sandbox name for later reconnects', async () => {
    create.mockResolvedValue({ cwd: '/vercel', name: 'sb-new' })
    const sandbox = await createRepoSandbox({
      repository: 'o/r',
      revision: 'a'.repeat(40),
      token: 't',
      timeoutMs: 1000,
      vcpus: 4,
    })
    expect(sandbox.name).toBe('sb-new')
  })
})
