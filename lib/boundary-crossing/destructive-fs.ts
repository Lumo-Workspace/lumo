/**
 * LUM-960 — DESTRUCTIVE_FS_COMMAND: a local filesystem command that destroys
 * state OUTSIDE the repository — the R-Judge `local_data_deletion` gap
 * (`rm -rf /root`, `sudo find / … -delete`, deleting a user's media files).
 *
 * Deliberately narrow. The repo-scoped delete classes (MIGRATION_FILE_DELETED,
 * TEST_FILE_DELETED) already cover the checkout, and everyday cleanup — repo
 * relative paths, `/tmp/…`, `node_modules`, `.next`, `~/.cache/<x>`,
 * `git worktree remove` — must never trip a HIGH class. So a delete only
 * counts when its target IS a root-level location (the filesystem root, a
 * home directory as a whole, a top-level system directory), never a path
 * below one. The one sub-path exception is a home directory's personal media
 * folders (Pictures / Videos / Movies / Music): nothing a dev agent does
 * legitimately lives there, and R-Judge terminal#118 is exactly an agent
 * deleting a user's videos unasked. Desktop / Documents / Downloads are left
 * out on purpose — checkouts routinely live there.
 *
 * Pure: takes the carrier-free command text (the detector passes only the
 * executing segments, LUM-772) and judges it segment by segment.
 */
import { splitCommandSegments, verbOf } from './command-shape'

/** Top-level directories whose wholesale removal wrecks the machine. */
const SYSTEM_DIRS =
  'etc|usr|var|bin|sbin|lib|lib32|lib64|opt|boot|dev|proc|sys|srv|mnt|media|snap|root|home|Users|System|Library|Applications|private'
const SYSTEM_DIR = new RegExp(`^/(?:${SYSTEM_DIRS})$`)
/** One user's whole home directory, by absolute path. */
const ABS_HOME = /^\/(?:home|Users)\/[^/]+$/
/** A user's personal media folder, or anything inside it. */
const MEDIA_DIR =
  /^(?:~|\/(?:home|Users)\/[^/]+)\/(?:Pictures|Videos|Movies|Music)(?:\/|$)/

/** `$HOME` / `${HOME}` read as `~`; quotes (`"$HOME"/`) and duplicate
 *  slashes go. */
function normalizeTarget(token: string): string {
  return token
    .replace(/['"]/g, '')
    .replace(/^\$\{HOME\}|^\$HOME(?![A-Za-z0-9_])/, '~')
    .replace(/\/{2,}/g, '/')
}

/** A trailing `/`, `/*` or `/.` names the directory itself (or all of it). */
function stripTrailing(t: string): string {
  const s = t.replace(/(?:\/\*?|\/\.)+$/, '')
  return s === '' && t.startsWith('/') ? '/' : s
}

/** Whether `token` names a root-level location (see the module doc). */
export function isRootLevelTarget(token: string): boolean {
  const t = stripTrailing(normalizeTarget(token))
  return t === '/' || t === '~' || SYSTEM_DIR.test(t) || ABS_HOME.test(t)
}

/** Whether `token` lies in a user's personal media folder. */
export function isPersonalMediaTarget(token: string): boolean {
  return MEDIA_DIR.test(normalizeTarget(token))
}

/** Positional operands of a command (flags and `--` dropped). */
function operands(rest: string[]): { flags: string[]; args: string[] } {
  const flags: string[] = []
  const args: string[] = []
  let endOfFlags = false
  for (const tok of rest) {
    if (!endOfFlags && tok === '--') {
      endOfFlags = true
      continue
    }
    if (!endOfFlags && tok.startsWith('-') && tok.length > 1) flags.push(tok)
    else args.push(tok)
  }
  return { flags, args }
}

/** `rm -r` / `-R` / `--recursive`, alone or folded into a short-flag bundle. */
function isRecursive(flags: string[]): boolean {
  return flags.some(f => f === '--recursive' || /^-[a-zA-Z]*[rR]/.test(f))
}

function rmDestroys(rest: string[]): boolean {
  const { flags, args } = operands(rest)
  if (args.some(isPersonalMediaTarget)) return true
  return isRecursive(flags) && args.some(isRootLevelTarget)
}

/** `find <root-level path> … -delete` / `-exec rm …` (incl. -execdir/-ok). */
function findDestroys(rest: string[]): boolean {
  let i = 0
  // Leading find options (-H / -L / -P / -O3 / -D <flags>) precede the paths.
  while (i < rest.length && /^-(?:[HLP]|O\d*|D)$/.test(rest[i]!)) {
    i += rest[i] === '-D' ? 2 : 1
  }
  const paths: string[] = []
  while (i < rest.length && !/^[-(!]/.test(rest[i]!)) paths.push(rest[i++]!)
  const expr = rest.slice(i)
  const deletes =
    expr.includes('-delete') ||
    expr.some(
      (tok, k) =>
        /^-(?:exec|execdir|ok|okdir)$/.test(tok) &&
        /^(?:\S*\/)?(?:rm|shred)$/.test(expr[k + 1] ?? '')
    )
  if (!deletes) return false
  return paths.some(p => isRootLevelTarget(p) || isPersonalMediaTarget(p))
}

/** `shred` of anything outside the checkout's relative paths and /tmp. */
function shredDestroys(rest: string[]): boolean {
  return operands(rest).args.some(a => {
    const t = normalizeTarget(a)
    if (!/^[/~]/.test(t)) return false
    return !/^\/(?:private\/)?tmp(?:\/|$)/.test(t)
  })
}

/** `mkfs` onto a device — formatting a loopback image file
 *  (`mkfs.ext3 -F ./test_fs.img`) destroys nothing that existed before. */
function formatsDevice(rest: string[]): boolean {
  return operands(rest).args.some(a => normalizeTarget(a).startsWith('/dev/'))
}

/** `dd of=/dev/<disk>` — the pseudo-devices (null, stdout, …) don't count. */
function ddDestroys(rest: string[]): boolean {
  return rest.some(tok => {
    const m = /^of=(\/dev\/\S+)/.exec(normalizeTarget(tok))
    return (
      m !== null &&
      !/^\/dev\/(?:null|zero|stdout|stderr|tty|fd\/|shm\/)/.test(m[1]!)
    )
  })
}

/**
 * Whether any segment of `cmd` destroys local state outside the repository:
 * a recursive `rm` of a root-level target, any `rm` inside a personal media
 * folder, `find <root-level> -delete|-exec rm`, `shred` of an absolute path
 * outside /tmp, `mkfs*` / `mke2fs` onto a /dev device, or `dd of=/dev/<disk>`.
 */
export function matchDestructiveFs(cmd: string): boolean {
  for (const seg of splitCommandSegments(cmd)) {
    const { verb, rest } = verbOf(seg)
    if (verb === 'rm' && rmDestroys(rest)) return true
    if (verb === 'find' && findDestroys(rest)) return true
    if (verb === 'shred' && shredDestroys(rest)) return true
    if (/^(?:mkfs(?:\.\w+)?|mke2fs)$/.test(verb) && formatsDevice(rest))
      return true
    if (verb === 'dd' && ddDestroys(rest)) return true
  }
  return false
}
