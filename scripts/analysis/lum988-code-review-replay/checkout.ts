/**
 * LUM-988 (agentic verifier) — a read-only checkout of every benchmark PR at
 * its head, for the verifier's `run_shell` to explore. Production gives the
 * verifier the same thing: the sandbox VM's checkout of the PR head.
 *
 *   npx tsx scripts/analysis/lum988-code-review-replay/checkout.ts \
 *     --data <data dir from prepare.ts> --out <checkout root>
 *
 * One repository per owner/repo under `<out>/repos/`, the PR head fetched
 * shallowly from `pull/<n>/head`, and a detached worktree per PR at
 * `<out>/co/<pr key>`. Re-running skips what exists. Needs `git` and network.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { prKey } from './pr-key'

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : undefined
  if (!v) throw new Error(`--${name} is required`)
  return v
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

const dataDir = arg('data')
const out = arg('out')
const prs = JSON.parse(
  readFileSync(path.join(dataDir, 'prs.json'), 'utf8')
) as string[]
mkdirSync(path.join(out, 'repos'), { recursive: true })
mkdirSync(path.join(out, 'co'), { recursive: true })

for (const url of prs) {
  const [owner, repo, , num] = url.split('github.com/')[1]!.split('/')
  const dest = path.join(out, 'co', prKey(url))
  if (existsSync(dest)) {
    process.stdout.write(`${url.split('github.com/')[1]} exists\n`)
    continue
  }
  const repoDir = path.join(out, 'repos', `${owner}_${repo}`)
  if (!existsSync(repoDir)) {
    mkdirSync(repoDir, { recursive: true })
    git(repoDir, ['init', '-q'])
    git(repoDir, [
      'remote',
      'add',
      'origin',
      `https://github.com/${owner}/${repo}.git`,
    ])
  }
  const ref = `refs/pr/${num}`
  git(repoDir, [
    'fetch',
    '-q',
    '--depth',
    '1',
    'origin',
    `pull/${num}/head:${ref}`,
  ])
  git(repoDir, ['worktree', 'add', '-q', '--detach', dest, ref])
  const sha = git(dest, ['rev-parse', 'HEAD']).trim()
  process.stdout.write(`${url.split('github.com/')[1]} ${sha.slice(0, 12)}\n`)
}
