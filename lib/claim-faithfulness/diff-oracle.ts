import { execFileSync } from 'child_process'
import type { CommandRunner, TaskDelivery } from './types'

const IDENTIFIER_RE = /^[A-Z][A-Z0-9]*-\d+$/

const defaultRun: CommandRunner = (file, args) =>
  execFileSync(file, args, {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'ignore'],
  })

function gitLog(
  identifier: string,
  format: string,
  run: CommandRunner
): string[] {
  const out = run('git', [
    'log',
    'origin/main',
    '-F',
    '--grep',
    `[${identifier}]`,
    `--format=${format}`,
  ])
  return out
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
}

export function resolveDelivery(
  identifier: string,
  run: CommandRunner = defaultRun
): TaskDelivery | null {
  if (!IDENTIFIER_RE.test(identifier)) return null

  const shas = gitLog(identifier, '%H', run)
  if (shas.length === 0) return null

  const commitSubjects = gitLog(identifier, '%s', run)
  const prNumbers = commitSubjects
    .map(s => s.match(/\(#(\d+)\)/)?.[1])
    .filter((n): n is string => Boolean(n))
    .map(Number)

  const numstat = run('git', ['show', '--numstat', '--format=', ...shas])
  let additions = 0
  let deletions = 0
  const changedFiles: string[] = []
  for (const line of numstat.split('\n')) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
    if (!m) continue
    if (m[1] !== '-') additions += Number(m[1])
    if (m[2] !== '-') deletions += Number(m[2])
    if (!changedFiles.includes(m[3])) changedFiles.push(m[3])
  }

  const diff = run('git', ['show', '--no-color', '--format=', ...shas])

  return {
    identifier,
    shas,
    prNumbers,
    diff,
    commitSubjects,
    changedFiles,
    additions,
    deletions,
  }
}

export function filterGhByExactTag(
  prs: { number: number; title: string }[],
  identifier: string
): number[] {
  return prs.filter(p => p.title.includes(`[${identifier}]`)).map(p => p.number)
}

export function truncateDiff(diff: string, max = 14_000): string {
  if (diff.length <= max) return diff
  return `${diff.slice(0, max)}\n…[truncated ${diff.length - max} chars]`
}
