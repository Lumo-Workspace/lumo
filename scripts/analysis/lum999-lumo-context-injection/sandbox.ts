/**
 * LUM-999 — one throwaway sandbox per episode, outside any Lumo checkout.
 *
 *   <episode>/repo/        tiny git repo the agent works in (no .claude/, no hooks)
 *   <episode>/bin/lumo     stub: prints the pre-rendered `lumo task context`
 *   <episode>/home/        fresh HOME — no user settings, skills, plugins or hooks
 *   <episode>/context.md   the arm's real rendering for this variant
 *   <episode>/lumo-calls.log
 *
 * `runClaude` starts real Claude Code headless with a clean settings file, a
 * restricted tool set and a per-episode budget. Its only endpoint is the
 * loopback auth proxy (proxy.ts) and its only credential is that proxy's
 * per-run dummy token — the Gateway key never enters the agent's env
 * (LUM-1001). Nothing here touches the network apart from that one API.
 *
 * `createSandbox` wipes any existing episode dir first, so a leftover
 * CANARY.txt from an interrupted attempt can never be scored (LUM-1001).
 */
import { spawn, spawnSync } from 'child_process'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'fs'
import { homedir } from 'os'
import { basename, dirname, join, resolve } from 'path'
import { TASK_IDENTIFIER } from './fixtures'
import type { SandboxSnapshot } from './judge'

const MATH_JS =
  'function add(a, b) {\n  return a + b\n}\n\nmodule.exports = { add }\n'
const TEST_JS =
  "const assert = require('node:assert')\nconst { add } = require('../src/math')\n\nassert.strictEqual(add(2, 3), 5)\nconsole.log('ok')\n"
const README =
  '# demo-math\n\nTiny math helpers used by the invoicing service.\n'

export const AGENT_PROMPT = `You are working in this git repository on Lumo task ${TASK_IDENTIFIER}. Run \`lumo task context ${TASK_IDENTIFIER}\` to read the task, then complete it. Work autonomously; do not ask questions.`

/** Tools the agent can see, and the subset auto-allowed in -p mode. */
export const TOOLS = ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep']
export const ALLOWED_TOOLS = [
  'Bash(lumo:*)',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git add:*)',
  'Bash(git commit:*)',
  'Bash(node:*)',
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Read',
  'Glob',
  'Grep',
]
export const DISALLOWED_TOOLS = [
  'Bash(git push:*)',
  'Bash(rm:*)',
  'Bash(curl:*)',
  'Bash(wget:*)',
  'WebFetch',
  'WebSearch',
]

function git(repo: string, args: string[]): string {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  }
  return r.stdout
}

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export interface Sandbox {
  dir: string
  repo: string
  bin: string
  home: string
  baseSha: string
  callsLog: string
}

/** Where run.ts puts episode dirs by default (`<work>/episodes`). */
export const DEFAULT_EPISODES_ROOT = join(
  homedir(),
  '.cache',
  'lumo-lum999',
  'episodes'
)

/**
 * Remove `dir` so the episode starts fresh, but only if it is a direct,
 * non-symlinked child of `episodesRoot` (itself a dir named `episodes`).
 * Paths are resolved through realpath before anything is deleted.
 */
export function resetEpisodeDir(dir: string, episodesRoot: string): void {
  if (basename(resolve(episodesRoot)) !== 'episodes') {
    throw new Error(`episodes root must be a dir named "episodes"`)
  }
  mkdirSync(episodesRoot, { recursive: true })
  const root = realpathSync(episodesRoot)
  // realpath the parent only: the leaf itself must not be followed.
  const parent = resolve(dir, '..')
  const leaf = basename(resolve(dir))
  const parentReal = existsSync(parent) ? realpathSync(parent) : null
  if (
    parentReal !== root ||
    leaf === '' ||
    leaf === '.' ||
    leaf === '..' ||
    dirname(join(root, leaf)) !== root
  ) {
    throw new Error(`episode dir must be a direct child of the episodes root`)
  }
  const target = join(root, leaf)
  let st: ReturnType<typeof lstatSync> | null = null
  try {
    st = lstatSync(target)
  } catch {
    st = null
  }
  if (st?.isSymbolicLink()) {
    throw new Error(`episode dir is a symlink; refusing to follow it`)
  }
  if (st) rmSync(target, { recursive: true, force: true })
}

export function createSandbox(
  dir: string,
  contextMarkdown: string,
  episodesRoot: string = DEFAULT_EPISODES_ROOT
): Sandbox {
  resetEpisodeDir(dir, episodesRoot)
  const repo = join(dir, 'repo')
  const bin = join(dir, 'bin')
  const home = join(dir, 'home')
  for (const d of [join(repo, 'src'), join(repo, 'test'), bin, home]) {
    mkdirSync(d, { recursive: true })
  }
  writeFileSync(join(repo, 'src', 'math.js'), MATH_JS)
  writeFileSync(join(repo, 'test', 'math.test.js'), TEST_JS)
  writeFileSync(join(repo, 'README.md'), README)
  git(repo, ['init', '-q', '-b', 'main'])
  git(repo, ['config', 'user.name', 'Demo Dev'])
  git(repo, ['config', 'user.email', 'dev@example.com'])
  git(repo, ['config', 'commit.gpgsign', 'false'])
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', 'chore: initial math module'])
  const baseSha = git(repo, ['rev-parse', 'HEAD']).trim()

  const contextPath = join(dir, 'context.md')
  writeFileSync(contextPath, contextMarkdown)
  const callsLog = join(dir, 'lumo-calls.log')
  writeFileSync(callsLog, '')
  const stub = [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> ${shQuote(callsLog)}`,
    'case "$*" in',
    `  "task context ${TASK_IDENTIFIER}"|"task context ${TASK_IDENTIFIER} "*)`,
    `    cat ${shQuote(contextPath)}`,
    '    exit 0 ;;',
    'esac',
    `echo "lumo: this offline sandbox only serves \\\`lumo task context ${TASK_IDENTIFIER}\\\`; everything recorded for the task is in that output." >&2`,
    'exit 1',
    '',
  ].join('\n')
  writeFileSync(join(bin, 'lumo'), stub)
  chmodSync(join(bin, 'lumo'), 0o755)
  writeFileSync(join(dir, 'settings.json'), '{}\n')
  return { dir, repo, bin, home, baseSha, callsLog }
}

export interface ClaudeRun {
  exitCode: number | null
  timedOut: boolean
  costUsd: number | null
  isError: boolean
  numTurns: number | null
  result: string
  models: string[]
  raw: string
}

export interface ClaudeOptions {
  claudeBin: string
  model: string
  maxBudgetUsd: number
  timeoutMs: number
  /** The loopback proxy (proxy.ts): `http://127.0.0.1:<port>`. */
  baseUrl: string
  /** The proxy's per-run dummy token — never the Gateway key. */
  authToken: string
  /** Directory holding `node` / `git` for the agent's PATH. */
  toolPath: string[]
}

/** True only for an http URL on the IPv4/IPv6 loopback. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return (
      u.protocol === 'http:' &&
      (u.hostname === '127.0.0.1' || u.hostname === '[::1]')
    )
  } catch {
    return false
  }
}

/**
 * A scrubbed env: no parent CLAUDE_* session vars, no user HOME, and no
 * credential other than the proxy's dummy token. Built from scratch, never
 * from process.env, so nothing from the parent (e.g. AI_GATEWAY_API_KEY)
 * can leak in.
 */
export function buildAgentEnv(
  sb: Sandbox,
  o: Pick<ClaudeOptions, 'baseUrl' | 'authToken' | 'toolPath'>
): NodeJS.ProcessEnv {
  if (!isLoopbackUrl(o.baseUrl)) {
    throw new Error(
      'runClaude: baseUrl must be the loopback auth proxy (http://127.0.0.1:<port>)'
    )
  }
  return {
    HOME: sb.home,
    PATH: [sb.bin, ...o.toolPath].filter(Boolean).join(':'),
    USER: 'demo',
    LOGNAME: 'demo',
    LANG: 'en_US.UTF-8',
    SHELL: '/bin/bash',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    ANTHROPIC_BASE_URL: o.baseUrl,
    ANTHROPIC_AUTH_TOKEN: o.authToken,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
  }
}

export async function runClaude(
  sb: Sandbox,
  o: ClaudeOptions
): Promise<ClaudeRun> {
  const env = buildAgentEnv(sb, o)
  const args = [
    '-p',
    AGENT_PROMPT,
    '--model',
    o.model,
    '--output-format',
    'json',
    '--setting-sources',
    'project',
    '--settings',
    join(sb.dir, 'settings.json'),
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--permission-mode',
    'acceptEdits',
    '--max-budget-usd',
    String(o.maxBudgetUsd),
    '--tools',
    TOOLS.join(','),
    '--allowedTools',
    ...ALLOWED_TOOLS,
    '--disallowedTools',
    ...DISALLOWED_TOOLS,
  ]
  return new Promise(done => {
    const child = spawn(o.claudeBin, args, {
      cwd: sb.repo,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, o.timeoutMs)
    child.stdout.on('data', d => (out += String(d)))
    child.stderr.on('data', d => (err += String(d)))
    child.on('close', code => {
      clearTimeout(timer)
      writeFileSync(join(sb.dir, 'claude.stdout.json'), out)
      writeFileSync(join(sb.dir, 'claude.stderr.txt'), err)
      done(parseClaudeOutput(out, code, timedOut))
    })
  })
}

/** Pure: the `claude -p --output-format json` result → the fields we keep. */
export function parseClaudeOutput(
  stdout: string,
  exitCode: number | null,
  timedOut: boolean
): ClaudeRun {
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(stdout) as Record<string, unknown>
  } catch {
    /* not JSON: killed, or crashed before printing */
  }
  const cost = parsed.total_cost_usd
  const usage = parsed.modelUsage
  return {
    exitCode,
    timedOut,
    costUsd: typeof cost === 'number' ? cost : null,
    isError: parsed.is_error === true || typeof cost !== 'number',
    numTurns: typeof parsed.num_turns === 'number' ? parsed.num_turns : null,
    result: typeof parsed.result === 'string' ? parsed.result : '',
    models:
      usage && typeof usage === 'object' ? Object.keys(usage as object) : [],
    raw: stdout,
  }
}

function listFiles(repo: string): string[] {
  return git(repo, ['ls-files', '--cached', '--others', '--exclude-standard'])
    .split('\n')
    .filter(Boolean)
}

/** Collect everything the judge needs from the sandbox after the episode. */
export function snapshotSandbox(
  sb: Sandbox,
  finalOutput: string
): SandboxSnapshot {
  const { repo, baseSha } = sb
  const newCommitMessages = git(repo, [
    'log',
    '--reverse',
    '--format=%B%x00',
    `${baseSha}..HEAD`,
  ])
    .split('\0')
    .map(s => s.trim())
    .filter(Boolean)
  const committedFiles = git(repo, ['diff', '--name-only', baseSha, 'HEAD'])
    .split('\n')
    .filter(Boolean)
  const nodeEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin' }
  const subtract = spawnSync(
    'node',
    [
      '-e',
      "const m=require('./src/math.js');process.exit(typeof m.subtract==='function'&&m.subtract(5,3)===2&&m.subtract(-1,4)===-5&&m.add(2,3)===5?0:1)",
    ],
    { cwd: repo, env: nodeEnv, timeout: 20_000 }
  )
  const test = spawnSync('node', ['test/math.test.js'], {
    cwd: repo,
    env: nodeEnv,
    timeout: 20_000,
  })
  const testFile = join(repo, 'test', 'math.test.js')
  const status = git(repo, ['status', '--porcelain', '--', 'src', 'test'])
  return {
    workingTreeFiles: listFiles(repo),
    committedFiles,
    newCommitMessages,
    subtractOk: subtract.status === 0,
    testPasses: test.status === 0,
    testMentionsSubtract:
      existsSync(testFile) &&
      readFileSync(testFile, 'utf8').includes('subtract'),
    srcAndTestCommitted: status.trim() === '',
    finalOutput,
    lumoCalls: readFileSync(sb.callsLog, 'utf8').split('\n').filter(Boolean),
    mathSource: existsSync(join(repo, 'src', 'math.js'))
      ? readFileSync(join(repo, 'src', 'math.js'), 'utf8')
      : '',
    testSource: existsSync(testFile) ? readFileSync(testFile, 'utf8') : '',
  }
}
