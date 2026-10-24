/**
 * @jest-environment node
 *
 * LUM-1310 — reading a repository archive for the issue assessment's
 * bounded head search: the tar reader (ustar prefix, pax and GNU long names,
 * the archive directory stripped, size / wantPath skips, any chunking, a
 * real `git archive`), and the tarball stream (one request, gunzipped,
 * stopped by the byte cap or the deadline, a failed request throws).
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
  revokeInstallationToken: jest.fn().mockResolvedValue(true),
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import { execFileSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { TarReader } from '@/lib/integrations/github/tar-reader'
import { streamRepoTarballWithToken } from '@/lib/integrations/github/contents'

// ── a minimal tar writer (the format GitHub's archive uses) ─────────────────

function header(name: string, size: number, type: string, prefix = ''): Buffer {
  const h = Buffer.alloc(512)
  h.write(name, 0, 100, 'utf8')
  h.write('0000644\0', 100)
  h.write('0000000\0', 108)
  h.write('0000000\0', 116)
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124)
  h.write('00000000000\0', 136)
  h.write(type, 156)
  h.write('ustar\0', 257)
  h.write('00', 263)
  h.write(prefix, 345, 155, 'utf8')
  h.write('        ', 148)
  let sum = 0
  for (const b of h) sum += b
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
  return h
}

function entry(
  name: string,
  body: Buffer | string,
  type = '0',
  prefix = ''
): Buffer {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body)
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512)
  return Buffer.concat([header(name, data.length, type, prefix), data, pad])
}

function pax(records: Record<string, string>): string {
  return Object.entries(records)
    .map(([k, v]) => {
      const rest = ` ${k}=${v}\n`
      let len = rest.length + 1
      while (`${len}${rest}`.length !== len) len = `${len}${rest}`.length
      return `${len}${rest}`
    })
    .join('')
}

const END = Buffer.alloc(1024)
const TOP = 'acme-app-abc1234'

function archive(): Buffer {
  const longPath = `${TOP}/app/${'deep/'.repeat(30)}page.tsx`
  return Buffer.concat([
    entry('pax_global_header', pax({ comment: 'abc1234' }), 'g'),
    entry(`${TOP}/`, '', '5'),
    entry(`${TOP}/app/a.tsx`, "t('common.loading')\n"),
    entry('b.tsx', 'b\n', '0', `${TOP}/app/nested`),
    entry('PaxHeader', pax({ path: longPath }), 'x'),
    entry('ignored-short-name', 'long pax path\n'),
    entry('././@LongLink', `${TOP}/lib/gnu-long-name.ts\0`, 'L'),
    entry('trunc', 'gnu long name\n'),
    entry(`${TOP}/app/big.json`, 'x'.repeat(3000)),
    entry(`${TOP}/docs/skip.md`, 'not wanted'),
    entry(`${TOP}/app/link`, '', '2'),
    END,
  ])
}

function readAll(buf: Buffer, chunk: number, maxFileBytes = 2048) {
  const files: Record<string, string> = {}
  const r = new TarReader({
    maxFileBytes,
    wantPath: p => !p.startsWith('docs/'),
    onFile: (p, c) => {
      files[p] = c.toString('utf8')
    },
  })
  for (let i = 0; i < buf.length; i += chunk) r.push(buf.subarray(i, i + chunk))
  return { files, done: r.done }
}

describe('TarReader', () => {
  const expected = {
    'app/a.tsx': "t('common.loading')\n",
    'app/nested/b.tsx': 'b\n',
    [`app/${'deep/'.repeat(30)}page.tsx`]: 'long pax path\n',
    'lib/gnu-long-name.ts': 'gnu long name\n',
  }

  it.each([1, 7, 512, 513, 4096, 1 << 20])(
    'reads the wanted regular files, archive dir stripped (chunks of %i bytes)',
    chunk => {
      const { files, done } = readAll(archive(), chunk)
      expect(files).toEqual(expected)
      expect(done).toBe(true)
    }
  )

  it('a file over maxFileBytes is skipped unbuffered, and reading carries on past it', () => {
    const { files } = readAll(archive(), 999, 2048)
    expect(files['app/big.json']).toBeUndefined()
    expect(readAll(archive(), 999, 4096).files['app/big.json']).toHaveLength(
      3000
    )
  })

  it('reports each wanted file skipped for size (so a search can say absence is unproven there)', () => {
    const skipped: Array<[string, number]> = []
    const r = new TarReader({
      maxFileBytes: 2048,
      wantPath: p => !p.startsWith('docs/'),
      onFile: () => undefined,
      onSkip: (p, size) => skipped.push([p, size]),
    })
    r.push(archive())
    expect(skipped).toEqual([['app/big.json', 3000]])
  })

  it('reads a real `git archive` of this repository (pax global header, prefix)', () => {
    const tar = execFileSync(
      'git',
      [
        'archive',
        '--format=tar',
        `--prefix=${TOP}/`,
        'HEAD',
        '--',
        'lib/test-cases/freshness.ts',
      ],
      { cwd: process.cwd() }
    )
    const { files, done } = readAll(tar, 333, 1 << 20)
    expect(Object.keys(files)).toEqual(['lib/test-cases/freshness.ts'])
    expect(files['lib/test-cases/freshness.ts']).toContain(
      'export function deriveRunFreshness'
    )
    expect(done).toBe(true)
  })
})

describe('streamRepoTarballWithToken', () => {
  const fetchMock = jest.fn()
  const realFetch = global.fetch
  beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch
  })
  afterAll(() => {
    global.fetch = realFetch
  })
  beforeEach(() => jest.clearAllMocks())

  function gzResponse(raw: Buffer, chunk = 4096): Response {
    const gz = gzipSync(raw)
    let at = 0
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (at >= gz.length) return c.close()
        c.enqueue(new Uint8Array(gz.subarray(at, at + chunk)))
        at += chunk
      },
    })
    return new Response(body, { status: 200 })
  }

  const base = { token: 'tok', fullName: 'acme/app', ref: 'abc1234' }

  it('one request for the head archive; every gunzipped byte reaches the reader', async () => {
    fetchMock.mockResolvedValue(gzResponse(archive()))
    const files: string[] = []
    const reader = new TarReader({
      maxFileBytes: 1 << 20,
      wantPath: () => true,
      onFile: p => files.push(p),
    })
    const read = await streamRepoTarballWithToken({
      ...base,
      maxBytes: 1 << 20,
      signal: AbortSignal.timeout(5_000),
      onChunk: c => reader.push(c),
    })
    expect(read).toEqual({
      complete: true,
      bytes: archive().length,
      stop: 'end',
    })
    expect(files).toContain('app/a.tsx')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.github.com/repos/acme/app/tarball/abc1234')
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it('stops at the byte cap: incomplete, never claims the whole archive', async () => {
    fetchMock.mockResolvedValue(gzResponse(Buffer.alloc(200_000, 0x61), 1024))
    const seen: number[] = []
    const read = await streamRepoTarballWithToken({
      ...base,
      maxBytes: 50_000,
      signal: AbortSignal.timeout(5_000),
      onChunk: c => seen.push(c.length),
    })
    expect(read.complete).toBe(false)
    expect(read.stop).toBe('size')
    expect(seen.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(50_000)
  })

  it('stops at the deadline: incomplete', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(async () => {
      const body = new ReadableStream<Uint8Array>({
        pull(c) {
          // Never ends on its own; the abort errors the stream.
          controller.signal.addEventListener('abort', () =>
            c.error(controller.signal.reason)
          )
        },
      })
      setTimeout(() => controller.abort(new Error('timeout')), 20)
      return new Response(body, { status: 200 })
    })
    const read = await streamRepoTarballWithToken({
      ...base,
      maxBytes: 1 << 20,
      signal: controller.signal,
      onChunk: () => undefined,
    })
    expect(read).toEqual({ complete: false, bytes: 0, stop: 'time' })
  })

  it('a failed request throws with its status', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 404 }))
    await expect(
      streamRepoTarballWithToken({
        ...base,
        maxBytes: 1 << 20,
        signal: AbortSignal.timeout(5_000),
        onChunk: () => undefined,
      })
    ).rejects.toMatchObject({ status: 404 })
  })
})
