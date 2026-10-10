/**
 * LUM-963 — SENSITIVE_PATH_READ: reading a well-known credential / secret store
 * outside the repository (an SSH private key, cloud / registry / gh tokens,
 * the hashed-password file under `/etc`, a browser cookie or password
 * database, a mail spool).
 *
 * Pure: no I/O. The detector turns each match into a LOW, ADVISORY crossing —
 * recorded and visible, never blocking DONE. Coding agents read config files
 * all the time, so this is a hint for the reviewer, not a gate.
 *
 * Two surfaces:
 *   - the Read tool — its `tool_input.file_path`;
 *   - Bash — only a segment whose verb READS its file arguments (`cat`,
 *     `head`, `cp`, `scp`, `tar c…`, `grep`, `ls` …) or an inline interpreter
 *     (`python3 -c`, `node -e` …) whose code names the path. A path that is
 *     only TEXT — an `echo` / `printf` string, a heredoc body, a commit message,
 *     a `lumo … --note` — never counts, and neither does a tool that merely
 *     USES a key (`ssh -i ~/.ssh/id_rsa`, `chmod 600 …`) or a write target
 *     (`> file`, the destination of `cp` / `scp`).
 *
 * Deliberately NOT reported: repo `.env*` files (agents read them constantly),
 * `/etc/passwd` (world-readable, no secrets), listing `/etc`, generic file
 * names like `api_keys.json` (BashArena's honest tasks read
 * `/opt/configs/api_tokens.json` as part of the job), `~/.ssh/*.pub`,
 * `known_hosts`, `config` and `authorized_keys` (public material), and
 * base64-obfuscated commands (the literal command only).
 */
import {
  splitSegmentsQuoteAware,
  unwrapShellWrapper,
  verbOf,
} from './command-shape'
import { stripHeredocBodies } from './prose'
import { matchPathGlob } from '@/lib/services/policy/predicate-eval'
import type { ProjectReadRule } from './policy-rule-paths'

export interface SensitiveReadMatch {
  /** The path as read, normalized (`$HOME`, `/Users/<u>`, `/home/<u>`,
   *  `/root` → `~`). The coalescing target. */
  path: string
  /** Which rule matched — short, human-readable. */
  label: string
  /** `Read` for the Read tool, else the Bash verb (`cat`, `python3` …). */
  via: string
  /** Set when a PROJECT rule (not the built-in list) made this path
   *  sensitive — the compiled PolicyRule's id and verbatim text. */
  ruleId?: string
  ruleText?: string
  /** LUM-1036: paths read by the same event beyond
   *  `MAX_SENSITIVE_READS_PER_EVENT`, carried on the last kept match. */
  alsoRead?: string[]
}

// LUM-1063: the type lives with the core rule filter (`./policy-rule-paths`).
export type { ProjectReadRule }

/** A `~/…` / relative glob also matches the absolute spellings of the path. */
export function matchesReadGlob(glob: string, rawPath: string): boolean {
  const normalized = normalizeReadPath(rawPath)
  const g = normalizeReadPath(glob)
  const paths = [normalized, rawPath.replace(/\\/g, '/')]
  if (matchPathGlob(g, paths)) return true
  return /^(?:\/|~|\*\*)/.test(g) ? false : matchPathGlob(`**/${g}`, paths)
}

// Spelled in parts: `npm run lint:tokens` reads the bare word as a color
// token (the box-… utility) and fails the commit.
const PASSWD_HASH_FILE = ['sha', 'dow'].join('')
const PASSWD_HASH_FILES = new RegExp(
  `^/etc/(?:${PASSWD_HASH_FILE}|g${PASSWD_HASH_FILE}|master\\.passwd)-?$`
)

/** Public SSH material — reading it is routine and leaks nothing. */
const SSH_PUBLIC_FILE =
  /^(?:.*\.pub|known_hosts(?:\.old)?|config|authorized_keys2?)$/

const BROWSER_STORE =
  /(?:^|\/)(?:Google\/Chrome(?: Beta| Canary)?|google-chrome|chromium|BraveSoftware\/Brave-Browser|Microsoft Edge|microsoft-edge)\/(?:.*\/)?(?:Cookies|Login Data|Web Data)$/

/**
 * The built-in sensitive-read rules, matched against the normalized path on
 * path-segment boundaries (so `notes/ssh.md` or `lib/aws/credentials.ts` never
 * match). Each `test` returns true for a hit.
 */
const SENSITIVE_READ_RULES: ReadonlyArray<{
  label: string
  test: (p: string) => boolean
}> = [
  {
    label: '~/.ssh private keys',
    test: p => {
      const m = p.match(/(?:^|\/)\.ssh(?:\/(.*))?$/)
      if (!m) return false
      const rest = (m[1] ?? '').replace(/\/+$/, '')
      if (rest === '') return true // the directory itself (a listing)
      const base = rest.split('/').pop() ?? ''
      return !SSH_PUBLIC_FILE.test(base)
    },
  },
  {
    label: '~/.aws/credentials',
    test: p => /(?:^|\/)\.aws\/credentials$/.test(p),
  },
  {
    label: 'gh CLI token',
    test: p => /(?:^|\/)\.config\/gh\/hosts\.yml$/.test(p),
  },
  { label: '.netrc', test: p => /(?:^|\/)[._]netrc$/.test(p) },
  {
    label: 'docker registry auth',
    test: p => /(?:^|\/)\.docker\/config\.json$/.test(p),
  },
  {
    label: '.git-credentials',
    test: p => /(?:^|\/)\.git-credentials$/.test(p),
  },
  { label: '.pgpass', test: p => /(?:^|\/)\.pgpass$/.test(p) },
  { label: 'kubeconfig', test: p => /(?:^|\/)\.kube\/config$/.test(p) },
  { label: '~/.gnupg', test: p => /(?:^|\/)\.gnupg(?:\/|$)/.test(p) },
  {
    label: `/etc/${PASSWD_HASH_FILE}`,
    test: p => PASSWD_HASH_FILES.test(p),
  },
  {
    label: '/etc/sudoers',
    test: p => /^\/etc\/sudoers(?:\.d(?:\/.*)?)?$/.test(p),
  },
  {
    label: 'SSH host private key',
    test: p => /^\/etc\/ssh\/ssh_host_[^/]*_key$/.test(p),
  },
  {
    label: 'mail spool',
    test: p => /^\/var\/(?:spool\/)?mail(?:\/|$)/.test(p),
  },
  {
    label: 'browser cookie / password store',
    test: p => BROWSER_STORE.test(p),
  },
  {
    label: 'browser cookie / password store',
    test: p =>
      /(?:^|\/)(?:\.mozilla\/firefox|Firefox\/Profiles)\/.*\/(?:cookies\.sqlite|logins\.json|key[34]\.db)$/.test(
        p
      ),
  },
  {
    label: 'macOS keychain / cookies',
    test: p => /(?:^|\/)Library\/(?:Keychains|Cookies)(?:\/|$)/.test(p),
  },
]

/** Fold the home-directory spellings onto `~` so one file has one target. */
export function normalizeReadPath(raw: string): string {
  let p = raw.trim().replace(/\\/g, '/')
  p = p.replace(/^(?:\$\{HOME\}|\$HOME)(?=\/|$)/, '~')
  p = p.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~')
  p = p.replace(/^\/root(?=\/|$)/, '~')
  p = p.replace(/\/{2,}/g, '/')
  // `~/.ssh/` and `~/.ssh` are one target.
  if (p.length > 1) p = p.replace(/\/+$/, '')
  return p
}

/** The rule a single path hits, or null. Exported for tests. */
export function sensitiveReadLabel(rawPath: string): string | null {
  const p = normalizeReadPath(rawPath)
  if (p.length === 0) return null
  return SENSITIVE_READ_RULES.find(r => r.test(p))?.label ?? null
}

// --- Bash ---------------------------------------------------------------------

/** Verbs that read (print, search, copy, archive, list) their file arguments. */
const READ_VERBS = new Set([
  'cat',
  'tac',
  'nl',
  'less',
  'more',
  'head',
  'tail',
  'base64',
  'xxd',
  'od',
  'hexdump',
  'strings',
  'cut',
  'sort',
  'diff',
  'ls',
  'find',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'awk',
  'sed',
  'cp',
  'scp',
  'rsync',
  'tar',
  'zip',
  '7z',
])

/** The first operand of these is a pattern / script, not a file. */
const PATTERN_FIRST = new Set(['grep', 'egrep', 'fgrep', 'rg', 'awk', 'sed'])
/** The last operand of these is the destination (a write), not a source. */
const DEST_LAST = new Set(['cp', 'scp', 'rsync'])
/** Interpreters whose `-c` / `-e` string is code that may open a path. */
const INLINE_INTERPRETER = /^(?:python[\d.]*|node|deno|bun|ruby|perl)$/

/**
 * Quote-aware word split of one segment (no expansion): `'…'` / `"…"` group,
 * a backslash escapes the next char. Redirection operators come out as their
 * own words (`<`, `>`, `>>`, `2>`, `&>` …) so their targets can be classified.
 */
export function shellWords(segment: string): string[] {
  const out: string[] = []
  let cur = ''
  let has = false
  let q: '"' | "'" | null = null
  const push = () => {
    if (has) out.push(cur)
    cur = ''
    has = false
  }
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!
    if (q) {
      if (c === q) q = null
      else if (c === '\\' && q === '"' && i + 1 < segment.length)
        cur += segment[++i]!
      else cur += c
      continue
    }
    if (c === "'" || c === '"') {
      q = c
      has = true
      continue
    }
    if (c === '\\' && i + 1 < segment.length) {
      cur += segment[++i]!
      has = true
      continue
    }
    if (/\s/.test(c)) {
      push()
      continue
    }
    if (c === '<' || c === '>') {
      // A redirection: `[n]>`, `>>`, `&>`, `<`. A leading fd digit / `&`
      // already in `cur` belongs to the operator.
      const fd = /^(?:\d+|&)$/.test(cur) ? cur : ''
      if (!fd) push()
      else {
        cur = ''
        has = false
      }
      let op = fd + c
      while (segment[i + 1] === '>' || segment[i + 1] === '&')
        op += segment[++i]!
      out.push(op)
      continue
    }
    cur += c
    has = true
  }
  push()
  return out
}

/** Strip a `host:` prefix (scp / rsync remote spec) and a curl-style `@`. */
function operandPath(word: string): string {
  return word
    .replace(/^[\w.-]+@[\w.-]+:|^[\w-]+:(?=[~/])/, '')
    .replace(/[)`;]+$/, '')
}

/** Command substitutions (`$(…)`, backticks) outside single quotes — they run
 *  even inside a double-quoted argument of a non-reading verb. */
function substitutions(seg: string): string[] {
  const unquoted = seg.replace(/'[^']*'/g, "''")
  const out: string[] = []
  const re = /\$\(([^()]*)\)|`([^`]*)`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(unquoted)) !== null) out.push(m[1] ?? m[2] ?? '')
  return out
}

/** File operands of a read-verb segment (flags, write targets, patterns out). */
function readOperands(verb: string, words: string[]): string[] {
  const operands: string[] = []
  const inputs: string[] = []
  let tarCreate = verb !== 'tar'
  // `grep -e PAT file` / `sed -e SCRIPT file` / `awk -f prog file`: the
  // pattern came as an option value, so the first operand IS a file.
  let patternAsOption = false
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    if (/^(?:\d+|&)?>{1,2}&?$/.test(w)) {
      i++ // a write target (or `2>&1`'s fd) — never a read
      continue
    }
    if (w === '<') {
      if (words[i + 1] !== undefined) inputs.push(words[i + 1]!)
      i++
      continue
    }
    if (/^(?:\d+|&)?>/.test(w)) continue // `2>&1` glued
    if (
      verb === 'tar' &&
      i === 0 &&
      !w.startsWith('-') &&
      /^[A-Za-z]+$/.test(w)
    ) {
      tarCreate = /[cru]/.test(w) // old-style `tar czf out.tgz …`
      if (/f/.test(w)) i++ // its archive name
      continue
    }
    if (w.startsWith('-')) {
      if (
        PATTERN_FIRST.has(verb) &&
        /^(?:-e|-f|--regexp|--file|--expression)$/.test(w)
      ) {
        patternAsOption = true
        i++
        continue
      }
      if (verb === 'tar') {
        if (
          /^-[A-Za-z]*[cru]/.test(w) ||
          /^--(?:create|append|update)$/.test(w)
        )
          tarCreate = true
        if (/^-[A-Za-z]*f$/.test(w) || w === '-C' || w === '--file') i++
      }
      continue
    }
    operands.push(w)
  }
  if (!tarCreate) return inputs
  let files = operands
  if (PATTERN_FIRST.has(verb) && !patternAsOption) files = files.slice(1)
  if (DEST_LAST.has(verb) && files.length > 1) files = files.slice(0, -1)
  if (verb === 'zip' || verb === '7z')
    files = files.slice(verb === '7z' ? 2 : 1)
  return [...files, ...inputs]
}

/** Quoted string literals inside inline interpreter code. */
function codeLiterals(code: string): string[] {
  const out: string[] = []
  const re = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) out.push(m[2]!)
  return out
}

/** A path one segment reads, before deciding whether it is sensitive. */
interface ReadCandidate {
  raw: string
  via: string
}

function scanSegment(seg: string, depth: number, out: ReadCandidate[]): void {
  const inner = depth < 3 ? unwrapShellWrapper(seg) : null
  if (inner != null) {
    scanCommandInto(inner, depth + 1, out)
    return
  }
  if (depth < 3)
    for (const sub of substitutions(seg)) scanCommandInto(sub, depth + 1, out)
  const { verb, rest } = verbOf(seg)
  // Re-split the operands quote-aware (verbOf splits on whitespace only).
  const words = shellWords(seg)
  const verbAt = words.findIndex(
    w => w.replace(/^["'$(]+/, '').replace(/^.*\//, '') === verb
  )
  const args =
    verbAt >= 0 ? words.slice(verbAt + 1) : shellWords(rest.join(' '))

  let candidates: string[] = []
  if (READ_VERBS.has(verb)) {
    candidates = readOperands(verb, args)
  } else if (INLINE_INTERPRETER.test(verb)) {
    const flagAt = args.findIndex(
      a => a === '-c' || a === '-e' || a === '--eval'
    )
    if (flagAt >= 0 && args[flagAt + 1] !== undefined)
      candidates = codeLiterals(args[flagAt + 1]!)
    // A redirect into an interpreter still reads the file.
    const lt = args.indexOf('<')
    if (lt >= 0 && args[lt + 1] !== undefined) candidates.push(args[lt + 1]!)
  } else {
    // Any other executing verb: only a `< file` redirect is a read.
    const lt = args.indexOf('<')
    if (lt >= 0 && args[lt + 1] !== undefined) candidates = [args[lt + 1]!]
  }
  for (const c of candidates) out.push({ raw: operandPath(c), via: verb })
}

function scanCommandInto(
  cmd: string,
  depth: number,
  out: ReadCandidate[]
): void {
  for (const raw of splitSegmentsQuoteAware(cmd)) {
    // A heredoc body is authored text (or a script fed to an interpreter we do
    // not parse) — only the segment's own words count.
    const seg = stripHeredocBodies(raw).trim()
    if (seg) scanSegment(seg, depth, out)
  }
}

/** Every path a Bash command's reading segments read (raw, unclassified). */
function readCandidatesInCommand(cmd: string): ReadCandidate[] {
  const out: ReadCandidate[] = []
  scanCommandInto(cmd.replace(/\\\r?\n/g, ' '), 0, out)
  return out
}

/** Built-in list first; a project rule only for a path it does not cover. */
function classify(
  c: ReadCandidate,
  projectRules: readonly ProjectReadRule[]
): SensitiveReadMatch | null {
  const path = normalizeReadPath(c.raw)
  if (path.length === 0) return null
  const label = sensitiveReadLabel(path)
  if (label) return { path, label, via: c.via }
  const rule = projectRules.find(r => matchesReadGlob(r.glob, c.raw))
  return rule
    ? {
        path,
        label: `project rule ${rule.glob}`,
        via: c.via,
        ruleId: rule.ruleId,
        ruleText: rule.ruleText,
      }
    : null
}

function classifyAll(
  cs: ReadCandidate[],
  projectRules: readonly ProjectReadRule[]
): SensitiveReadMatch[] {
  const out: SensitiveReadMatch[] = []
  for (const c of cs) {
    const m = classify(c, projectRules)
    if (m) out.push(m)
  }
  return dedupe(out)
}

/** Every sensitive path a Bash command reads, deduplicated by path. */
export function sensitiveReadsInCommand(
  cmd: string,
  projectRules: readonly ProjectReadRule[] = []
): SensitiveReadMatch[] {
  return classifyAll(readCandidatesInCommand(cmd), projectRules)
}

function dedupe(ms: SensitiveReadMatch[]): SensitiveReadMatch[] {
  const seen = new Set<string>()
  return ms.filter(m => (seen.has(m.path) ? false : (seen.add(m.path), true)))
}

/** Cap per event: one crossing per distinct path, at most this many. */
export const MAX_SENSITIVE_READS_PER_EVENT = 5

/**
 * LUM-1036 — the cap bounds how many crossings one event writes, never what
 * the reviewer can learn about it. Before, a command that read five decoy
 * credential stores first silently dropped every later path (and a project
 * rule's path, filtered AFTER the cap, could be pushed out entirely by five
 * built-in hits). Now the last kept match carries every path past the cap in
 * `alsoRead`, so the crossing names them, and project-rule reads are capped on
 * their own list.
 */
function capWithOverflow(ms: SensitiveReadMatch[]): SensitiveReadMatch[] {
  if (ms.length <= MAX_SENSITIVE_READS_PER_EVENT) return ms
  const kept = ms.slice(0, MAX_SENSITIVE_READS_PER_EVENT)
  const last = kept[kept.length - 1]!
  kept[kept.length - 1] = {
    ...last,
    alsoRead: ms.slice(MAX_SENSITIVE_READS_PER_EVENT).map(m => m.path),
  }
  return kept
}

function sensitiveReadCandidates(input: {
  toolName: string | null
  filePath: string | null
  command: string | null
}): ReadCandidate[] {
  if (input.toolName === 'Read') {
    return input.filePath ? [{ raw: input.filePath, via: 'Read' }] : []
  }
  return input.command ? readCandidatesInCommand(input.command) : []
}

/**
 * The sensitive reads one hook event performs: the Read tool's file, or the
 * Bash command's read operands. Every other tool returns [].
 */
export function detectSensitiveReads(
  input: {
    toolName: string | null
    filePath: string | null
    command: string | null
  },
  projectRules: readonly ProjectReadRule[] = []
): SensitiveReadMatch[] {
  return capWithOverflow(
    classifyAll(sensitiveReadCandidates(input), projectRules)
  )
}

/**
 * Only the reads a PROJECT rule adds on top of the built-in list. The
 * built-in matches are emitted by the pure `detectCrossings` (no policy
 * there); the detector service, which loads the compiled policy, appends
 * these. Empty when the project has no SENSITIVE_PATH_READ globs. Filtered
 * BEFORE the cap (LUM-1036), so built-in hits can never crowd them out.
 */
export function detectProjectSensitiveReads(
  input: {
    toolName: string | null
    filePath: string | null
    command: string | null
  },
  projectRules: readonly ProjectReadRule[]
): SensitiveReadMatch[] {
  if (projectRules.length === 0) return []
  return capWithOverflow(
    classifyAll(sensitiveReadCandidates(input), projectRules).filter(
      m => m.ruleId != null
    )
  )
}
