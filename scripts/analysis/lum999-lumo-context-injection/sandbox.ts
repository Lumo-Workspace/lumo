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
 * restricted tool set and a per-episode budget, and auth from the env
 * (AI Gateway's Anthropic-compatible endpoint). Nothing here touches the
 * network apart from that one API.
 */
import { spawn, spawnSync } from 'child_process'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'fs'
import { join } from 'path'
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

export function createSandbox(dir: string, contextMarkdown: string): Sandbox {
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
  /** AI Gateway (Anthropic-compatible) credentials; never logged. */
  baseUrl: string
  authToken: string
  /** Directory holding `node` / `git` for the agent's PATH. */
  toolPath: string[]
}

export function runClaude(sb: Sandbox, o: ClaudeOptions): Promise<ClaudeRun> {
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
  // A scrubbed env: no parent CLAUDE_* session vars, no user HOME.
  const env: NodeJS.ProcessEnv = {
    HOME: sb.home,
    PATH: [sb.bin, ...o.toolPath].join(':'),
    USER: 'demo',
    LOGNAME: 'demo',
    LANG: 'en_US.UTF-8',
    SHELL: '/bin/bash',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    ANTHROPIC_BASE_URL: o.baseUrl,
    ANTHROPIC_AUTH_TOKEN: o.authToken,
    ANTHROPIC_API_KEY: '',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
  }
  return new Promise(resolve => {
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
      resolve(parseClaudeOutput(out, code, timedOut))
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
  }
}
