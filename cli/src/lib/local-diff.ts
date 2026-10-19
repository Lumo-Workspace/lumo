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

export type ScanScope =
  | { kind: 'staged' }
  | { kind: 'since'; ref: string }
  | { kind: 'default' }

export interface LocalDiff {
  /** Repo root every path is relative to. */
  root: string
  files: AddedFile[]
  /** Human description of what was diffed, e.g. `origin/main (merge-base 1a2b3c4) → working tree`. */
  description: string
  /** Untracked files left out: binary, symlinks, or over the size cap. */
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

function gitDiff(root: string, args: string[]): string {
  const r = runGit([...DIFF_FLAGS, ...args], root)
  if (r.error) throw r.error
  if (r.status !== 0) {
    throw new Error((r.stderr || '').trim() || 'git diff failed')
  }
  return r.stdout ?? ''
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
  const out = gitOutput(
    [
      '-c',
      'core.quotePath=false',
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
    ],
    root
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
    const buf = fs.readFileSync(abs)
    if (isBinaryContent(buf)) {
      skipped.push(rel)
      continue
    }
    files.push(fileAsAdded(rel, buf.toString('utf8')))
  }
  return files
}

function shortSha(root: string, ref: string): string {
  return gitOutput(['rev-parse', '--short', ref], root)
}

/**
 * Resolve the scope to a diff and parse it. Throws with an actionable message
 * when the scope cannot be resolved (no default branch, unknown ref).
 */
export function collectLocalDiff(scope: ScanScope, cwd?: string): LocalDiff {
  const root = gitOutput(['rev-parse', '--show-toplevel'], cwd)
  const skipped: string[] = []

  if (scope.kind === 'staged') {
    return {
      root,
      files: addedLinesWithNumbers(gitDiff(root, ['--cached'])),
      description: 'staged changes',
      skipped,
    }
  }

  let base: string
  let description: string
  if (scope.kind === 'since') {
    if (
      runGit(
        ['rev-parse', '--verify', '--quiet', `${scope.ref}^{commit}`],
        root
      ).status !== 0
    ) {
      throw new Error(
        `Unknown ref "${scope.ref}" — pass a branch, tag or commit to --since.`
      )
    }
    base = scope.ref
    description = `${scope.ref} → working tree`
  } else {
    const branch = detectDefaultBranch(root, { allowNetwork: false })
    if (!branch) {
      throw new Error(
        'Could not find the default branch (no origin/HEAD, origin/main or origin/master). Pass --since <ref> or --staged.'
      )
    }
    base = gitOutput(['merge-base', 'HEAD', `origin/${branch}`], root)
    description = `origin/${branch} (merge-base ${shortSha(root, base)}) → working tree`
  }

  const files = [
    ...addedLinesWithNumbers(gitDiff(root, [base])),
    ...untrackedFiles(root, skipped),
  ]
  return { root, files, description, skipped }
}
