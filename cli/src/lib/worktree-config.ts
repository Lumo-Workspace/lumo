import * as fs from 'fs'
import * as path from 'path'

/**
 * Repo-level worktree settings, read from `<main checkout>/.lumo/worktree.json`
 * (LUM-825). Everything that used to be hard-coded for the Lumo repo itself —
 * which paths to link or copy into a fresh worktree, the baseline test
 * command, the repo-specific gotchas — lives here, so a customer repo with no
 * file gets plain, repo-agnostic behaviour.
 *
 * A key that is present replaces the auto-detected default for that key
 * (e.g. `linkPaths: []` turns off the node_modules link); an absent key keeps
 * the default.
 */
export interface WorktreeConfig {
  /** Paths (relative to the repo root) symlinked from the main checkout. */
  linkPaths?: string[]
  /** Paths (relative to the repo root) copied from the main checkout. */
  copyPaths?: string[]
  /** Shell command `worktree add --verify` runs inside the new worktree. */
  verifyCommand?: string
  /** Repo-specific gotchas printed after `worktree add`. */
  notes?: string[]
  /** `session attach` creates the task's worktree when none exists. */
  autoWorktree?: boolean
}

export const WORKTREE_CONFIG_PATH = path.join('.lumo', 'worktree.json')

function stringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every(x => typeof x === 'string')
    ? (v as string[])
    : undefined
}

/**
 * Parse the config text; unknown keys and wrongly-typed values are dropped
 * (reported in `problems`) rather than failing the command — a malformed
 * file must never block creating or cleaning a worktree.
 */
export function parseWorktreeConfig(text: string): {
  config: WorktreeConfig
  problems: string[]
} {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { config: {}, problems: [`not valid JSON (${msg})`] }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { config: {}, problems: ['expected a JSON object'] }
  }
  const obj = raw as Record<string, unknown>
  const config: WorktreeConfig = {}
  const problems: string[] = []

  for (const key of ['linkPaths', 'copyPaths', 'notes'] as const) {
    if (!(key in obj)) continue
    const arr = stringArray(obj[key])
    if (arr) config[key] = arr
    else problems.push(`${key} must be an array of strings`)
  }
  if ('verifyCommand' in obj) {
    if (typeof obj.verifyCommand === 'string' && obj.verifyCommand.trim()) {
      config.verifyCommand = obj.verifyCommand
    } else problems.push('verifyCommand must be a non-empty string')
  }
  if ('autoWorktree' in obj) {
    if (typeof obj.autoWorktree === 'boolean') {
      config.autoWorktree = obj.autoWorktree
    } else problems.push('autoWorktree must be true or false')
  }
  const known = new Set([
    'linkPaths',
    'copyPaths',
    'verifyCommand',
    'notes',
    'autoWorktree',
  ])
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) problems.push(`unknown key "${key}" ignored`)
  }
  return { config, problems }
}

/** Read `.lumo/worktree.json` under `mainRoot`; a missing file is `{}`. */
export function readWorktreeConfig(mainRoot: string): {
  config: WorktreeConfig
  problems: string[]
} {
  let text: string
  try {
    text = fs.readFileSync(path.join(mainRoot, WORKTREE_CONFIG_PATH), 'utf8')
  } catch {
    return { config: {}, problems: [] }
  }
  return parseWorktreeConfig(text)
}
