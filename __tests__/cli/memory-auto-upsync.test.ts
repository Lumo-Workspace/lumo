/**
 * @jest-environment node
 *
 * LUM-551 — lifecycle upsync drain: outbox-empty fast path (no project
 * resolution, no network); non-empty drains + unlinks; disable env no-ops.
 */
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { autoUpsyncOnDrain } from '@/cli/src/lib/memory-auto'

function tmpWithOutbox(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'lumo-auto-up-'))
  const ob = join(dir, 'outbox')
  mkdirSync(ob, { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(ob, name), JSON.stringify(body))
  }
  return dir
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.LUMO_DISABLE_MEMORY_AUTO
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ outcome: 'created' }),
  }) as unknown as typeof fetch
})

it('empty outbox: never resolves the project, never hits the network', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumo-empty-'))
  const resolveProjectId = jest.fn().mockResolvedValue('p1')
  try {
    const res = await autoUpsyncOnDrain({
      cwd: process.cwd(),
      base: 'https://api.example.com',
      token: 't',
      resolveProjectId,
      dir,
    })
    expect(res.skipped).toBe('empty')
    expect(resolveProjectId).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('non-empty outbox: pushes each + unlinks on 2xx', async () => {
  const dir = tmpWithOutbox({
    'a.json': { category: 'TRAP', content: 'x' },
    'b.json': { category: 'DECISION', content: 'y' },
  })
  try {
    const res = await autoUpsyncOnDrain({
      cwd: process.cwd(),
      base: 'https://api.example.com',
      token: 't',
      resolveProjectId: async () => 'p1',
      dir,
    })
    expect(res.pushed).toBe(2)
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(2)
    expect(existsSync(join(dir, 'outbox', 'a.json'))).toBe(false)
    expect(existsSync(join(dir, 'outbox', 'b.json'))).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('keeps the file when its POST fails', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch
  const dir = tmpWithOutbox({ 'a.json': { category: 'TRAP', content: 'x' } })
  try {
    const res = await autoUpsyncOnDrain({
      cwd: process.cwd(),
      base: 'https://api.example.com',
      token: 't',
      resolveProjectId: async () => 'p1',
      dir,
    })
    expect(res.pushed).toBe(0)
    expect(existsSync(join(dir, 'outbox', 'a.json'))).toBe(true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('disable env no-ops without touching the outbox', async () => {
  process.env.LUMO_DISABLE_MEMORY_AUTO = '1'
  const dir = tmpWithOutbox({ 'a.json': { category: 'TRAP', content: 'x' } })
  try {
    const res = await autoUpsyncOnDrain({
      cwd: process.cwd(),
      base: 'https://api.example.com',
      token: 't',
      resolveProjectId: async () => 'p1',
      dir,
    })
    expect(res.skipped).toBe('disabled')
    expect(global.fetch).not.toHaveBeenCalled()
    expect(existsSync(join(dir, 'outbox', 'a.json'))).toBe(true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.LUMO_DISABLE_MEMORY_AUTO
  }
})
