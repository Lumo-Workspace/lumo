import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import {
  addedLinesWithNumbers,
  type AddedFile,
} from '../../../shared/src/diff-lines'
import { detectDefaultBranch, gitOutput, runGit } from './worktree'

/**
 * LUM-1255 — the added lines a local scan reads, built the way the PR scan
 * builds them: a unified diff parsed by the same `addedLinesWithNumbers`, with
 * repo-relative paths. Local-only additions: the default scope also reads the
 * working tree (uncommitted edits and untracked files), because those are what
 * the next commit will carry.
 */

/**
 * LUM-1258: `until` ends the diff at a commit instead of the working tree (no
 * untracked files) — what a pre-push hook scans: the commits being pushed.
 */
export type ScanScope =
  | { kind: 'staged' }
  | { kind: 'since'; ref: string; until?: string }
  | { kind: 'default'; until?: string }
  /** LUM-1259: one commit against its first parent (a root commit: everything). */
  | { kind: 'commit'; ref: string }

/** git's empty tree: what a root commit is diffed against. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

export interface LocalDiff {
  /** Repo root every path is relative to. */
  root: string
  files: AddedFile[]
  /** Human description of what was diffed, e.g. `origin/main (merge-base 1a2b3c4) → working tree`. */
  description: string
  /** Untracked files left out: binary, symlinks, unreadable, or over the size cap. */
  skipped: string[]
}

/** Untracked files above this are skipped (and reported) rather than read. */
export const UNTRACKED_MAX_BYTES = 2 * 1024 * 1024

/**
 * Flags that pin the diff format whatever the user's git config says:
 * `diff.noprefix` / `diff.mnemonicPrefix` would change the `b/` the parser
 * keys on, `core.quotePath` would quote non-ASCII paths, and external diff
 * drivers / textconv would replace the real content.
 */
const DIFF_FLAGS = [
  '-c',
  'core.quotePath=false',
  'diff',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--src-prefix=a/',
  '--dst-prefix=b/',
]

/**
 * Output cap for the diff and the untracked-file list. `spawnSync` defaults to
 * 1 MiB, which a large branch (or a merge in progress) passes easily.
 */
export const GIT_OUTPUT_MAX_BYTES = 512 * 1024 * 1024

/** Run git for a large output; throws an actionable error past the cap. */
function gitLarge(root: string, args: string[], what: string): string {
  const r = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: GIT_OUTPUT_MAX_BYTES,
    timeout: 120_000,
  })
  if (r.error) {
    if ((r.error as NodeJS.ErrnoException).code === 'ENOBUFS') {
      throw new Error(
        `${what} is larger than ${GIT_OUTPUT_MAX_BYTES / 1024 / 1024} MiB — narrow it with --staged or --since <ref>`
      )
    }
    throw r.error
  }
  if (r.status !== 0) {
    throw new Error((r.stderr || '').trim() || `git ${args[0] ?? ''} failed`)
  }
  return r.stdout ?? ''
}

function gitDiff(root: string, args: string[]): string {
  return gitLarge(root, [...DIFF_FLAGS, ...args], 'The diff')
}

/** True when the buffer looks binary (a NUL byte in its first 8000 bytes, git's own test). */
export function isBinaryContent(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0)
}

/** A whole file as added lines, numbered from 1 — what a diff of a new file yields. */
export function fileAsAdded(relPath: string, content: string): AddedFile {
  const text = content.endsWith('\n') ? content.slice(0, -1) : content
  if (text === '') return { path: relPath, lines: [] }
  return {
    path: relPath,
    lines: text
      .split('\n')
      .map((line, i) => ({ lineNo: i + 1, text: line.replace(/\r$/, '') })),
  }
}

function untrackedFiles(root: string, skipped: string[]): AddedFile[] {
  const out = gitLarge(
    root,
    [
      '-c',
      'core.quotePath=false',
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
    ],
    'The untracked file list'
  )
  const files: AddedFile[] = []
  for (const rel of out.split('\0').filter(Boolean)) {
    const abs = path.join(root, rel)
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(abs)
    } catch {
      continue
    }
    if (!stat.isFile() || stat.size > UNTRACKED_MAX_BYTES) {
      skipped.push(rel)
      continue
    }
    let buf: Buffer
    try {
      buf = fs.readFileSync(abs)
    } catch {
      // Unreadable (permissions, vanished mid-scan): report it, keep scanning.
      skipped.push(rel)
      continue
    }
    if (isBinaryContent(buf)) {
      skipped.push(rel)
      continue
    }
    files.push(fileAsAdded(rel, buf.toString('utf8')))
  }
  return files
}

function assertCommit(root: string, ref: string, flag: string): void {
  if (
    runGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], root)
      .status !== 0
  ) {
    throw new Error(
      `Unknown ref "${ref}" — pass a branch, tag or commit to ${flag}.`
    )
  }
}

/** A ref as given, but a full sha (what a pre-push hook passes) shortened. */
function refLabel(root: string, ref: string): string {
  return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(ref) ? shortSha(root, ref) : ref
}

function shortSha(root: string, ref: string): string {
  return gitOutput(['rev-parse', '--short', ref], root)
}

/**
 * What a scope compares: `base` (a revision) against the working tree, or —
 * for `staged` — `HEAD` against the index, or (LUM-1258 `--until`) against
 * the commit `until`.
 */
export interface ScanBase {
  root: string
  base: string
  head: 'worktree' | 'index' | 'commit'
  /** The commit `head: 'commit'` ends at, as given to `--until`. */
  until?: string
  /** Human description, e.g. `origin/main (merge-base 1a2b3c4) → working tree`. */
  description: string
}

/**
 * Resolve the scope to the revision it compares against. Throws with an
 * actionable message when it cannot be resolved (no default branch, unknown
 * ref).
 */
export function resolveScanBase(scope: ScanScope, cwd?: string): ScanBase {
  const root = gitOutput(['rev-parse', '--show-toplevel'], cwd)
  if (scope.kind === 'staged') {
    return { root, base: 'HEAD', head: 'index', description: 'staged changes' }
  }
  if (scope.kind === 'commit') {
    assertCommit(root, scope.ref, '--commit')
    const parent = runGit(
      ['rev-parse', '--verify', '--quiet', `${scope.ref}^1`],
      root
    )
    return {
      root,
      base: parent.status === 0 ? parent.stdout.trim() : EMPTY_TREE,
      head: 'commit',
      until: scope.ref,
      description: `commit ${shortSha(root, scope.ref)}`,
    }
  }
  const until = scope.until
  if (until !== undefined) assertCommit(root, until, '--until')
  const end = until === undefined ? 'working tree' : refLabel(root, until)
  const head =
    until === undefined
      ? { head: 'worktree' as const }
      : { head: 'commit' as const, until }
  if (scope.kind === 'since') {
    assertCommit(root, scope.ref, '--since')
    return {
      root,
      base: scope.ref,
      ...head,
      description: `${refLabel(root, scope.ref)} → ${end}`,
    }
  }
  const branch = detectDefaultBranch(root, { allowNetwork: false })
  if (!branch) {
    throw new Error(
      'Could not find the default branch (no origin/HEAD, origin/main or origin/master). Pass --since <ref> or --staged.'
    )
  }
  const base = gitOutput(
    ['merge-base', until ?? 'HEAD', `origin/${branch}`],
    root
  )
  return {
    root,
    base,
    ...head,
    description: `origin/${branch} (merge-base ${shortSha(root, base)}) → ${end}`,
  }
}

/**
 * Resolve the scope to a diff and parse it. Throws with an actionable message
 * when the scope cannot be resolved (no default branch, unknown ref).
 */
export function collectLocalDiff(scope: ScanScope, cwd?: string): LocalDiff {
  const { root, base, head, until, description } = resolveScanBase(scope, cwd)
  const skipped: string[] = []

  if (head === 'index') {
    return {
      root,
      files: addedLinesWithNumbers(gitDiff(root, ['--cached', '--'])),
      description,
      skipped,
    }
  }
  if (head === 'commit') {
    return {
      root,
      files: addedLinesWithNumbers(gitDiff(root, [base, until!, '--'])),
      description,
      skipped,
    }
  }
  const files = [
    // `--` ends the revisions: a ref that is also a path name stays a ref.
    ...addedLinesWithNumbers(gitDiff(root, [base, '--'])),
    ...untrackedFiles(root, skipped),
  ]
  return { root, files, description, skipped }
}
