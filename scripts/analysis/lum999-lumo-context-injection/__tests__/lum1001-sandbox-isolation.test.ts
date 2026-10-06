/**
 * @jest-environment node
 *
 * LUM-1001 — the agent under test must never hold a long-lived credential,
 * and every episode starts from a fresh dir.
 *
 * (a) runs the real `runClaude` against a fake `claude` binary that dumps the
 *     env it was given, with a fake Gateway key planted in the parent env.
 * (b) plants a leftover CANARY.txt in an episode dir before `createSandbox`.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  buildAgentEnv,
  createSandbox,
  isLoopbackUrl,
  runClaude,
} from '../sandbox'

const FAKE_KEY = 'FAKE-GATEWAY-KEY-lum1001-not-a-secret'

let tmp: string
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'lum1001-')))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

/** A `claude` stand-in that prints its own env, NUL-separated, to stdout. */
function fakeClaude(dir: string): string {
  const bin = join(dir, 'fake-claude')
  writeFileSync(bin, '#!/bin/sh\nexec /usr/bin/env -0\n')
  chmodSync(bin, 0o755)
  return bin
}

function agentEnv(sbDir: string): Record<string, string> {
  const raw = readFileSync(join(sbDir, 'claude.stdout.json'), 'utf8')
  const env: Record<string, string> = {}
  for (const entry of raw.split('\0').filter(Boolean)) {
    const i = entry.indexOf('=')
    env[entry.slice(0, i)] = entry.slice(i + 1)
  }
  return env
}

describe('(a) the env handed to the agent', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('has no *_API_KEY, no AI_GATEWAY_* and no value equal to the real key', async () => {
    process.env.AI_GATEWAY_API_KEY = FAKE_KEY
    process.env.ANTHROPIC_API_KEY = FAKE_KEY
    process.env.OPENAI_API_KEY = FAKE_KEY
    const root = join(tmp, 'episodes')
    const sb = createSandbox(join(root, 'ep-a'), '# ctx\n', root)
    await runClaude(sb, {
      claudeBin: fakeClaude(tmp),
      model: 'claude-haiku-4-5',
      maxBudgetUsd: 0.01,
      timeoutMs: 20_000,
      baseUrl: 'http://127.0.0.1:9',
      authToken: 'lum999-proxy-dummy',
      toolPath: ['/usr/bin', '/bin'],
    })
    const env = agentEnv(sb.dir)
    expect(Object.keys(env).length).toBeGreaterThan(3)
    expect(Object.keys(env).filter(k => /_API_KEY$/.test(k))).toEqual([])
    expect(Object.keys(env).filter(k => k.startsWith('AI_GATEWAY'))).toEqual([])
    expect(Object.values(env).filter(v => v.includes(FAKE_KEY))).toEqual([])
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:9')
  })

  it('refuses a non-loopback base URL, so the agent can only reach the local proxy', async () => {
    const root = join(tmp, 'episodes')
    const sb = createSandbox(join(root, 'ep-b'), '# ctx\n', root)
    await expect(
      runClaude(sb, {
        claudeBin: fakeClaude(tmp),
        model: 'claude-haiku-4-5',
        maxBudgetUsd: 0.01,
        timeoutMs: 20_000,
        baseUrl: 'https://ai-gateway.vercel.sh',
        authToken: FAKE_KEY,
        toolPath: ['/usr/bin', '/bin'],
      })
    ).rejects.toThrow(/loopback/)
    expect(existsSync(join(sb.dir, 'claude.stdout.json'))).toBe(false)
  })
})

describe('(b) episode dirs are always fresh', () => {
  it('a leftover CANARY.txt from an earlier attempt does not survive into the new episode', () => {
    const root = join(tmp, 'episodes')
    const dir = join(root, 'claude-haiku-4-5_before_clean_1')
    mkdirSync(join(dir, 'repo'), { recursive: true })
    writeFileSync(join(dir, 'repo', 'CANARY.txt'), 'leftover\n')
    writeFileSync(join(dir, 'CANARY.txt'), 'leftover\n')

    const sb = createSandbox(dir, '# ctx\n', root)

    expect(existsSync(join(sb.repo, 'CANARY.txt'))).toBe(false)
    expect(existsSync(join(dir, 'CANARY.txt'))).toBe(false)
    expect(readFileSync(join(sb.repo, 'src', 'math.js'), 'utf8')).toContain(
      'function add'
    )
  })

  it('refuses a dir outside the episodes root and leaves it untouched', () => {
    const root = join(tmp, 'episodes')
    mkdirSync(root, { recursive: true })
    const outside = join(tmp, 'not-an-episode')
    mkdirSync(outside)
    writeFileSync(join(outside, 'keep.txt'), 'keep\n')

    expect(() => createSandbox(outside, '# ctx\n', root)).toThrow(
      /episodes root/
    )
    expect(() =>
      createSandbox(join(root, '..', 'not-an-episode'), '# ctx\n', root)
    ).toThrow(/episodes root/)
    expect(() => createSandbox(root, '# ctx\n', root)).toThrow(/episodes root/)
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('keep\n')
  })

  it('refuses a symlinked episode dir instead of following it', () => {
    const root = join(tmp, 'episodes')
    mkdirSync(root, { recursive: true })
    const target = join(tmp, 'target')
    mkdirSync(target)
    writeFileSync(join(target, 'keep.txt'), 'keep\n')
    symlinkSync(target, join(root, 'ep-link'))

    expect(() => createSandbox(join(root, 'ep-link'), '# ctx\n', root)).toThrow(
      /symlink/
    )
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('keep\n')
  })
})

describe('pure helpers', () => {
  it('isLoopbackUrl accepts only http on 127.0.0.1 / [::1]', () => {
    expect(isLoopbackUrl('http://127.0.0.1:4321')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:4321')).toBe(true)
    expect(isLoopbackUrl('https://ai-gateway.vercel.sh')).toBe(false)
    expect(isLoopbackUrl('http://127.0.0.1.evil.example')).toBe(false)
    expect(isLoopbackUrl('http://localhost:4321')).toBe(false)
    expect(isLoopbackUrl('not a url')).toBe(false)
  })

  it('buildAgentEnv drops empty PATH entries', () => {
    const root = join(tmp, 'episodes')
    const sb = createSandbox(join(root, 'ep-env'), '# ctx\n', root)
    const env = buildAgentEnv(sb, {
      baseUrl: 'http://127.0.0.1:9',
      authToken: 'lum999-proxy-dummy',
      toolPath: ['', '/usr/bin'],
    })
    expect(env.PATH).toBe(`${sb.bin}:/usr/bin`)
  })
})
