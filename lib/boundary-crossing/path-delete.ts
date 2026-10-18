/**
 * LUM-1236 — "does this command delete or move a file under a protected path?"
 *
 * Shared by the built-in MIGRATION_FILE_DELETED matcher and the project rule
 * predicate `path-delete` (a "never delete files in <path>" rule from the
 * customer's CLAUDE.md / AGENTS.md). Pure, no I/O.
 *
 * Why it exists: the policy compiler turned "Never delete files in
 * prisma/migrations/" into a path-blind `cmd-substr: "rm"`. As a substring,
 * `rm` is inside `format`, `confirm`, `rmdir`, `task-testcase-rm.ts`, and in
 * every `git rm` / `rm -f` of an unrelated file — 12 HIGH false positives in
 * three days, none of which touched the path. A deletion rule is only ever
 * about WHICH files are removed, so it is judged here on the operands of the
 * delete itself:
 *
 *   - only a delete / move VERB counts (`rm`, `unlink`, `rmdir`, `shred`,
 *     `rimraf`, `git rm`, `mv`, `git mv`, `git clean`, `find … -delete` /
 *     `-exec rm`, `rsync --delete` / `--remove-source-files`, `xargs <one of
 *     these>` fed by an earlier pipeline stage, an inline interpreter script
 *     calling a delete API) — print / search / authoring verbs never reach it;
 *   - one of its OPERANDS must lie under the protected path (or be a parent
 *     directory of it, when the delete is recursive or a move);
 *   - `bash -c '…'` / `eval …` and `bash <<EOF` bodies are unwrapped, quotes
 *     are shell-unquoted (a quoted operand is still the operand), a heredoc
 *     body fed to anything else is text and dropped, and a preceding `cd` /
 *     `git -C` in the same command line resolves relative operands.
 *
 * Known limits (deliberately not guessed at): a loop variable (`for f in …;
 * do rm "$f"`) is not expanded, and moving a file INTO the path is not a
 * deletion.
 */
import {
  splitPipeStages,
  splitSegmentsQuoteAware,
  unwrapShellWrapper,
} from './command-shape'

/** The repository's migration history — the built-in category's path. */
export const MIGRATIONS_PATH = 'prisma/migrations'

/** One delete/move operand that lands on a protected path. */
export interface PathDeletion {
  /** The protected path it hit (normalised, no trailing slash). */
  path: string
  /** The operand as written. */
  operand: string
  /** The text that matched: the operand itself, or — when only the `cd`
   *  resolution made it match — the resolved path. */
  matched: string
}

/** Normalise a protected path: quotes/backticks, `./`, trailing `/`, a
 *  trailing `/**` or `/*` glob. `''` when nothing is left. */
export function normaliseProtectedPath(raw: string): string {
  let p = raw.trim().replace(/^[`'"]+|[`'"]+$/g, '')
  p = p.replace(/(?:\/\*\*?)+$/, '')
  while (p.startsWith('./')) p = p.slice(2)
  p = p.replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  return p === '.' ? '' : p
}

/** A `path-delete` predicate value (`a/b,c/d`) → normalised paths. */
export function parsePathDeleteValue(value: string): string[] {
  const out: string[] = []
  for (const part of value.split(',')) {
    const p = normaliseProtectedPath(part)
    if (p && !out.includes(p)) out.push(p)
  }
  return out
}

/** Every path lies under the repository's migration history — the built-in
 *  MIGRATION_FILE_DELETED detector already judges exactly these deletes. */
export function pathsCoveredByMigrationBuiltin(
  paths: readonly string[]
): boolean {
  return (
    paths.length > 0 &&
    paths.every(
      p => p === MIGRATIONS_PATH || p.startsWith(`${MIGRATIONS_PATH}/`)
    )
  )
}

// ── shell words ──────────────────────────────────────────────────────────────

/** Split one simple command into shell words, quotes removed (`'a b'` → one
 *  word `a b`), backslash escapes resolved. Best effort, never throws. */
export function shellWords(segment: string): string[] {
  const out: string[] = []
  let cur = ''
  let inWord = false
  let i = 0
  const s = segment
  while (i < s.length) {
    const c = s[i]!
    if (/\s/.test(c)) {
      if (inWord) out.push(cur)
      cur = ''
      inWord = false
      i++
      continue
    }
    inWord = true
    if (c === '\\' && i + 1 < s.length) {
      cur += s[i + 1]
      i += 2
      continue
    }
    if (c === "'" || (c === '$' && s[i + 1] === "'")) {
      const start = c === '$' ? i + 2 : i + 1
      const end = s.indexOf("'", start)
      cur += end === -1 ? s.slice(start) : s.slice(start, end)
      i = end === -1 ? s.length : end + 1
      continue
    }
    if (c === '"') {
      i++
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length) {
          cur += s[i + 1]
          i += 2
          continue
        }
        cur += s[i]
        i++
      }
      i++
      continue
    }
    cur += c
    i++
  }
  if (inWord) out.push(cur)
  return out
}

/** Tokens that never carry the verb (env assignments, launchers, control-flow
 *  keywords that introduce a command). */
const PREFIX_WORD =
  /^(?:[A-Za-z_][A-Za-z0-9_]*=.*|!|sudo|env|time|nohup|command|builtin|exec|nice|then|do|else|elif|if|while|until|\{|\()$/

interface Invocation {
  verb: string
  args: string[]
}

function invocationOf(words: readonly string[]): Invocation | null {
  let i = 0
  while (i < words.length - 1 && PREFIX_WORD.test(words[i]!)) i++
  const raw = words[i]
  if (raw == null) return null
  const verb = raw.replace(/^[({]+/, '').replace(/^.*\//, '')
  const args = words.slice(i + 1).map(w => w.replace(/\)+$/, ''))
  return { verb, args }
}

// ── operand helpers ──────────────────────────────────────────────────────────

/** Positional operands: everything not a flag, everything after `--`.
 *  `withValue` flags consume the next word. */
function positionals(
  args: readonly string[],
  withValue: ReadonlySet<string> = new Set()
): string[] {
  const out: string[] = []
  let flagsDone = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (!flagsDone && a === '--') {
      flagsDone = true
      continue
    }
    if (!flagsDone && a.startsWith('-') && a.length > 1) {
      if (withValue.has(a)) i++
      continue
    }
    out.push(a)
  }
  return out
}

const hasFlag = (args: readonly string[], re: RegExp) =>
  args.some(a => re.test(a))

const RECURSIVE_SHORT = /^-[a-zA-Z]*[rR][a-zA-Z]*$/
const RECURSIVE_LONG = /^--recursive$/

interface Target {
  operand: string
  /** Removing / moving this operand takes everything beneath it along. */
  recursive: boolean
}

const RM_VERBS = new Set([
  'rm',
  'unlink',
  'rmdir',
  'shred',
  'srm',
  'trash',
  'trash-put',
  'rimraf',
  'del',
])

/** Delete APIs an inline interpreter script may call on a path literal. */
const SCRIPT_DELETE_API =
  /\b(?:os\.(?:remove|unlink|rmdir|removedirs|rename|replace)|shutil\.(?:rmtree|move)|unlink(?:Sync)?|rmSync|rmdirSync|renameSync|rm|rmdir|rename|unlink_?|remove|rmtree|File\.delete|FileUtils\.rm_?r?f?)\s*\(/
const INTERPRETERS = /^(?:python[0-9.]*|node|perl|ruby|bun|deno|php)$/

/** The operands one invocation removes or moves away. */
function deleteTargets(inv: Invocation, piped: readonly string[]): Target[] {
  const { verb, args } = inv
  if (RM_VERBS.has(verb)) {
    const recursive =
      verb === 'rimraf' ||
      verb === 'del' ||
      hasFlag(args, RECURSIVE_SHORT) ||
      hasFlag(args, RECURSIVE_LONG)
    return positionals(args).map(operand => ({ operand, recursive }))
  }
  if (verb === 'mv') {
    const target = args.findIndex(
      a => a === '-t' || a.startsWith('--target-directory')
    )
    const pos = positionals(args, new Set(['-t', '-S', '--suffix']))
    const sources = target !== -1 ? pos : pos.slice(0, -1)
    return sources.map(operand => ({ operand, recursive: true }))
  }
  if (verb === 'find') {
    const mutating = args.some(
      (a, i) =>
        a === '-delete' ||
        (/^-(?:exec|execdir|ok|okdir)$/.test(a) &&
          /^(?:rm|unlink|rmdir|shred|mv|git)$/.test(
            (args[i + 1] ?? '').replace(/^.*\//, '')
          ))
    )
    if (!mutating) return []
    const out: Target[] = []
    let i = 0
    for (; i < args.length; i++) {
      const a = args[i]!
      if (a.startsWith('-') || a === '(' || a === '!' || a === '\\(') break
      out.push({ operand: a, recursive: true })
    }
    // A `-path 'prisma/migrations/*'` style expression names the target too.
    for (; i < args.length; i++) {
      const a = args[i]!
      if (!a.startsWith('-') && a.includes('/'))
        out.push({ operand: a, recursive: true })
    }
    return out
  }
  if (verb === 'rsync') {
    const pos = positionals(args)
    const out: Target[] = []
    if (hasFlag(args, /^--delete/) && pos.length > 0)
      out.push({ operand: pos[pos.length - 1]!, recursive: true })
    if (hasFlag(args, /^--remove-source-files$/))
      for (const operand of pos.slice(0, -1))
        out.push({ operand, recursive: true })
    return out
  }
  if (verb === 'git') return gitTargets(args)
  if (verb === 'xargs') {
    // `… | xargs [opts] rm` — the operands come from the earlier stages.
    const XARGS_VALUE = /^-[IinPdLsEa]$/
    let i = 0
    while (i < args.length && args[i]!.startsWith('-')) {
      if (XARGS_VALUE.test(args[i]!)) i++
      i++
    }
    const inner = invocationOf(args.slice(i))
    if (!inner || inner.verb === 'xargs') return []
    const direct = deleteTargets(inner, [])
    const deletes =
      direct.length > 0 ||
      RM_VERBS.has(inner.verb) ||
      inner.verb === 'mv' ||
      (inner.verb === 'git' && /^(?:rm|mv)$/.test(inner.args[0] ?? ''))
    if (!deletes) return []
    return [...direct, ...piped.map(operand => ({ operand, recursive: true }))]
  }
  if (INTERPRETERS.test(verb)) {
    const at = args.findIndex(a => a === '-c' || a === '-e' || a === '--eval')
    if (at === -1) return []
    return scriptTargets(args[at + 1] ?? '')
  }
  return []
}

function gitTargets(args: readonly string[]): Target[] {
  let i = 0
  while (i < args.length && args[i]!.startsWith('-')) {
    if (args[i] === '-C' || args[i] === '-c') i++
    i++
  }
  const sub = args[i]
  const rest = args.slice(i + 1)
  if (sub === 'rm') {
    const recursive = hasFlag(rest, RECURSIVE_SHORT)
    return positionals(rest).map(operand => ({ operand, recursive }))
  }
  if (sub === 'mv') {
    return positionals(rest)
      .slice(0, -1)
      .map(operand => ({ operand, recursive: true }))
  }
  if (sub === 'clean') {
    return positionals(rest, new Set(['-e', '--exclude'])).map(operand => ({
      operand,
      recursive: true,
    }))
  }
  return []
}

/** Path-looking string literals of an inline script that calls a delete API. */
function scriptTargets(code: string): Target[] {
  if (!SCRIPT_DELETE_API.test(code)) return []
  const out: Target[] = []
  for (const m of code.matchAll(/["'`]([^"'`\n]*\/[^"'`\n]*)["'`]/g))
    out.push({ operand: m[1]!, recursive: true })
  return out
}

// ── path arithmetic ──────────────────────────────────────────────────────────

const isAnchored = (p: string) => /^[/~$]/.test(p)

function normaliseOperand(raw: string): string {
  let o = raw.trim()
  while (o.startsWith('./')) o = o.slice(2)
  o = o.replace(/\/{2,}/g, '/')
  if (o.length > 1) o = o.replace(/\/+$/, '')
  return o
}

/** `a/b/../c` → `a/c`; a leading `..` that cannot be resolved is kept. */
function collapseDots(p: string): string {
  const parts: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '.' || (seg === '' && parts.length > 0)) continue
    if (seg === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') {
      parts.pop()
      continue
    }
    parts.push(seg)
  }
  return parts.join('/')
}

function joinPath(base: string | null, rel: string): string {
  if (base == null || isAnchored(rel)) return rel
  return collapseDots(`${base}/${rel}`)
}

function ancestorsOf(path: string): string[] {
  const segs = path.split('/')
  const out: string[] = []
  for (let n = 1; n < segs.length; n++) out.push(segs.slice(0, n).join('/'))
  return out
}

function globToRegExp(glob: string): RegExp {
  let re = ''
  for (const c of glob) {
    if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

/** Does deleting (or moving away) `operand` touch something under `path`? */
export function operandTouchesPath(
  rawOperand: string,
  path: string,
  recursive: boolean
): boolean {
  const o = normaliseOperand(rawOperand)
  if (!o || o === '.' || o === '..' || o === '/' || o === '~') return false
  const globAt = o.search(/[*?[]/)
  const literal = globAt === -1 ? o : o.slice(0, globAt)
  // The operand (or the literal part of its glob) lies under the path.
  const under = (s: string) =>
    s === path ||
    s.startsWith(`${path}/`) ||
    s.includes(`/${path}/`) ||
    s.endsWith(`/${path}`)
  if (globAt === -1) {
    if (under(o)) return true
  } else if (literal.endsWith('/') && under(literal.replace(/\/+$/, ''))) {
    // `prisma/migrations/*`, `$W/prisma/migrations/2024*/…`
    return true
  } else if (literal.startsWith(`${path}/`) || literal.includes(`/${path}/`)) {
    return true
  }
  if (!recursive) return false
  // A parent directory of the path, removed recursively or moved away.
  const ancestors = ancestorsOf(path)
  if (globAt === -1)
    return ancestors.some(
      a => o === a || (isAnchored(o) && o.endsWith(`/${a}`))
    )
  if (isAnchored(o)) return false
  const re = globToRegExp(o)
  return [path, ...ancestors].some(c => re.test(c))
}

// ── the walk ─────────────────────────────────────────────────────────────────

const SHELLS = /^(?:bash|sh|zsh|dash|ksh)$/
const MAX_DEPTH = 3

/** A unit's first line (the command) and, when it opens a heredoc, its body. */
function splitHeredoc(unit: string): { head: string; body: string | null } {
  const m = unit.match(/<<-?\s*(['"]?)([A-Za-z_]\w*)\1/)
  const nl = unit.indexOf('\n')
  if (!m || m.index == null || nl === -1 || m.index > nl)
    return { head: unit, body: null }
  const lines = unit.slice(nl + 1).split('\n')
  const end = lines.findIndex(l => l.trim() === m[2])
  return {
    head: unit.slice(0, m.index) + unit.slice(m.index + m[0].length, nl),
    body: (end === -1 ? lines : lines.slice(0, end)).join('\n'),
  }
}

function nextCwd(cwd: string | null, arg: string | undefined): string | null {
  if (arg == null || arg === '~' || arg === '-' || arg === '') return null
  const a = normaliseOperand(arg)
  if (isAnchored(a)) return a
  if (cwd == null) return a === '..' ? null : collapseDots(a)
  return joinPath(cwd, a)
}

function walk(
  cmd: string,
  paths: readonly string[],
  out: PathDeletion[],
  depth: number,
  inheritedCwd: string | null
): void {
  let cwd = inheritedCwd
  for (const unitRaw of splitSegmentsQuoteAware(cmd, { pipes: false })) {
    const unit = unitRaw.trim()
    if (!unit) continue
    const piped: string[] = []
    for (const stageRaw of splitPipeStages(unit)) {
      const stage = stageRaw.trim()
      if (!stage) continue
      const inner = depth < MAX_DEPTH ? unwrapShellWrapper(stage) : null
      if (inner != null) {
        walk(inner, paths, out, depth + 1, cwd)
        continue
      }
      const { head, body } = splitHeredoc(stage)
      const words = shellWords(head)
      const inv = invocationOf(words)
      if (!inv) continue
      if (body != null && depth < MAX_DEPTH) {
        // `bash <<EOF` runs its body; `python3 - <<EOF` may delete in it; any
        // other carrier (`cat > f <<EOF`, `git commit -F -`) is only text.
        if (SHELLS.test(inv.verb)) walk(body, paths, out, depth + 1, cwd)
        else if (INTERPRETERS.test(inv.verb))
          collect(scriptTargets(body), cwd, paths, out)
      }
      if (inv.verb === 'cd' || inv.verb === 'pushd') {
        cwd = nextCwd(cwd, positionals(inv.args)[0])
        continue
      }
      if (inv.verb === 'eval' && depth < MAX_DEPTH) {
        walk(inv.args.join(' '), paths, out, depth + 1, cwd)
        continue
      }
      let opCwd = cwd
      if (inv.verb === 'git') {
        const c = inv.args.indexOf('-C')
        if (c !== -1) opCwd = nextCwd(cwd, inv.args[c + 1])
      }
      collect(deleteTargets(inv, piped), opCwd, paths, out)
      piped.push(...inv.args.filter(a => !a.startsWith('-')))
    }
  }
}

function collect(
  targets: readonly Target[],
  cwd: string | null,
  paths: readonly string[],
  out: PathDeletion[]
): void {
  for (const t of targets) {
    const resolved = joinPath(cwd, normaliseOperand(t.operand))
    for (const path of paths) {
      if (operandTouchesPath(t.operand, path, t.recursive)) {
        out.push({ path, operand: t.operand, matched: t.operand })
      } else if (
        resolved !== t.operand &&
        operandTouchesPath(resolved, path, t.recursive)
      ) {
        out.push({ path, operand: t.operand, matched: resolved })
      }
    }
  }
}

/**
 * Every delete / move operand of `command` that lands on one of `paths`.
 * `[]` when the command deletes nothing under them. Pure, never throws.
 */
export function protectedPathDeletions(
  command: string,
  paths: readonly string[]
): PathDeletion[] {
  const norm = paths.map(normaliseProtectedPath).filter(Boolean)
  if (!command || norm.length === 0) return []
  const out: PathDeletion[] = []
  try {
    walk(command, norm, out, 0, null)
  } catch {
    // A parser surprise must not lose a real delete: fall back to the
    // plain question "is a delete verb next to the path?".
    return norm
      .filter(
        p =>
          command.includes(p) &&
          /(?:^|[\s;&|(])(?:rm|mv|unlink)\s/.test(command)
      )
      .map(p => ({ path: p, operand: p, matched: p }))
  }
  return out
}

/** The `path-delete` predicate: does `command` delete / move a file under any
 *  of the paths in `value` (comma-separated)? */
export function matchPathDelete(value: string, command: string): boolean {
  return protectedPathDeletions(command, parsePathDeleteValue(value)).length > 0
}
