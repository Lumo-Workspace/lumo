/**
 * LUM-962 — dependency installs and download-and-execute, beyond npm.
 *
 * Two questions, answered from the command text alone (pure, no I/O):
 *
 *   1. Does a segment install a NEW package by name from a registry
 *      (`npm i x`, `pip install x`, `uv add x`, `gem install x`, `cargo
 *      install x`, `go install x@v` …)? → NEW_NPM_DEPENDENCY (LOW). The enum
 *      keeps its historical name; its meaning is "names a new dependency" for
 *      every ecosystem, the same semantics npm always had.
 *   2. Does the command run code fetched from an unvetted source?
 *      → UNTRUSTED_CODE_EXECUTION (HIGH):
 *        · an install whose source is a VCS / URL spec (`pip install
 *          git+https://…`, `pip install https://…/x.whl`, `npm i
 *          github:u/r`, `cargo install --git …`) — the package's build
 *          hooks run arbitrary code from wherever that URL points;
 *        · a download piped into an interpreter (`curl … | sh`,
 *          `wget -qO- … | sudo bash`, `curl … | python3 -`);
 *        · a download handed to an interpreter by substitution
 *          (`bash <(curl …)`, `bash -c "$(curl …)"`, `eval "$(curl …)"`);
 *        · a download written to a file that the same command then makes
 *          executable or runs (`curl -o x.sh … && chmod +x x.sh`,
 *          `wget -O f …; bash f`, `v=$(curl …) && echo "$v" > f && ./f`).
 *
 * Deliberately NOT covered (judgement, not shape — LUM-958's LLM judge): a
 * locally present script being run (`python3 reverse_shell.py`), a download
 * in one Bash call executed in a LATER call (the detector sees one event at a
 * time), a custom package index (`--index-url`, `--extra-index-url`), and
 * `npx` / `uvx` / `pipx run` one-shot execution of a registry package.
 *
 * Only EXECUTING segments count (LUM-751/772): echo / grep / cat / lumo /
 * gh-authoring carriers and `git commit` messages are text, a heredoc body is
 * text unless a shell is the one reading it, and a `#` comment is ignored.
 */
import { stripHeredocBodies } from './action-confirm'
import {
  executingSegments,
  isReadOnlySegment,
  splitPipeStages,
  splitSegmentsQuoteAware,
  unwrapShellWrapper,
} from './command-shape'

/** What a command's install segments name. */
export interface InstallSources {
  /** At least one registry package is named (→ NEW_NPM_DEPENDENCY). */
  named: boolean
  /** At least one VCS / URL source is installed (→ UNTRUSTED_CODE_EXECUTION). */
  remote: boolean
}

/** A VCS / URL install source, in pip (`git+https://`, PEP 508 `pkg @ url`),
 *  npm (`github:u/r`, `git@host:u/r`) or plain-URL spelling. */
const REMOTE_SPEC =
  /^(?:(?:git|hg|svn|bzr)\+|https?:\/\/|git:\/\/|ssh:\/\/|ftp:\/\/|git@[\w.-]+:|(?:github|gitlab|bitbucket|gist):)/i
/** `name@git+https://…` / `name@https://…` — a remote spec behind a name. */
const AT_REMOTE = /@\s*(?:(?:git|hg|svn|bzr)\+|https?:\/\/)/i
/** A local archive / path: never a new registry package, never remote. */
const LOCAL_SPEC = /^(?:[.~/]|\$PWD\b)|\.(?:whl|tar\.gz|tgz|zip|gem|egg)$/i

/** Strip the wrapping quotes / argv-list punctuation around one token. */
function cleanToken(tok: string): string {
  return tok.replace(/^[\s'"`([,]+/, '').replace(/[\s'"`)\],]+$/, '')
}

function isRemoteSpec(tok: string): boolean {
  return REMOTE_SPEC.test(tok) || AT_REMOTE.test(tok)
}

/** Shell redirections with their targets (`2>&1`, `> log`, `&>/dev/null`,
 *  `< in`) and quotes/parens left over from a wrapper — none are packages
 *  (the LUM-957 cleanup, shared by every ecosystem). */
function dropRedirections(args: string): string {
  return args.replace(
    /(?:^|\s)(?:\d*|&)>>?(?:&\d+|\s*\S+)|(?:^|\s)\d*<\s*\S+|['"`)]+(?=\s|$)/g,
    ' '
  )
}

/** Drop a trailing `# comment` (a `#` that starts a token — a URL fragment
 *  such as `git+https://…#egg=x` is kept). */
function dropComment(seg: string): string {
  return seg.replace(/(?:^|\s)#[\s\S]*$/, '')
}

/** Drop every unquoted `# comment` up to its newline BEFORE splitting into
 *  segments — a comment swallows any `&&` / `|` after it on that line. */
function stripComments(cmd: string): string {
  let out = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!
    if (quote) {
      if (c === '\\' && quote === '"' && i + 1 < cmd.length) {
        out += c + cmd[++i]!
        continue
      }
      if (c === quote) quote = null
      out += c
      continue
    }
    if (c === '\\' && i + 1 < cmd.length) {
      out += c + cmd[++i]!
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '#' && (i === 0 || /\s/.test(cmd[i - 1]!))) {
      const nl = cmd.indexOf('\n', i)
      if (nl < 0) break
      i = nl - 1
      continue
    }
    out += c
  }
  return out
}

interface EcosystemArgs {
  /** The tokens after the install verb. */
  args: string[]
  /** Options whose NEXT token is their value (skipped, never a package). */
  valueFlags: ReadonlySet<string>
  /** Options whose value is itself a source spec (`-e git+…`, `--git url`). */
  specFlags: ReadonlySet<string>
  /** Tokens that count as a named package — default: any non-flag token. */
  isName?: (tok: string) => boolean
  /** Treat local paths / archives as not-a-package (pip, cargo, gem …). */
  localAware: boolean
}

const PIP_VALUE_FLAGS = new Set([
  '-r',
  '--requirement',
  '-c',
  '--constraint',
  '-i',
  '--index-url',
  '--extra-index-url',
  '--index',
  '--default-index',
  '-f',
  '--find-links',
  '-t',
  '--target',
  '--prefix',
  '--root',
  '--python-version',
  '--platform',
  '--implementation',
  '--abi',
  '--src',
  '--upgrade-strategy',
  '--progress-bar',
  '--log',
  '--cache-dir',
  '--trusted-host',
  '--proxy',
  '--timeout',
  '--retries',
  '--exists-action',
  '--cert',
  '--client-cert',
  '--report',
  '-C',
  '--config-settings',
  '--global-option',
  '--no-binary',
  '--only-binary',
  '--python',
  '-p',
  '--group',
  '--extra',
  '--optional',
  '--source',
  '--with',
  '--suffix',
])
const PIP_SPEC_FLAGS = new Set(['-e', '--editable'])
const CARGO_VALUE_FLAGS = new Set([
  '--version',
  '--vers',
  '--branch',
  '--tag',
  '--rev',
  '--root',
  '--index',
  '--registry',
  '--features',
  '-F',
  '--target',
  '--bin',
  '--example',
  '-j',
  '--jobs',
  '--profile',
  '--rename',
  '--package',
  '-p',
  '--path',
])
const CARGO_SPEC_FLAGS = new Set(['--git'])
const GEM_VALUE_FLAGS = new Set([
  '-v',
  '--version',
  '-i',
  '--install-dir',
  '-n',
  '--bindir',
  '-s',
  '--source',
  '--platform',
])
const NONE: ReadonlySet<string> = new Set()

/** `pip`, `pip3`, `pip3.12`, `python -m pip`, `uv pip`, `uv add`, `uv tool
 *  install`, `pipx install`, `poetry add`, `gem install`, `cargo install|add`,
 *  `go install|get` — the verb and its argument tokens, else null. npm's
 *  family is matched separately (verbOf treats yarn/pnpm as launchers). */
function ecosystemArgs(seg: string): EcosystemArgs | null {
  const toks = seg.trim().split(/\s+/).filter(Boolean)
  let i = 0
  // Launchers / env prefixes never carry the verb.
  while (
    i < toks.length &&
    /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*|sudo|env|time|nohup|command|exec)$/.test(
      toks[i]!
    )
  )
    i++
  // sudo's own flags (`sudo -H pip …`, `sudo -u app pip …`).
  while (i < toks.length && /^-/.test(toks[i]!)) {
    i += toks[i] === '-u' || toks[i] === '-g' ? 2 : 1
  }
  const verb = (toks[i] ?? '').replace(/^.*\//, '')
  const rest = toks.slice(i + 1)
  const pip = (from: number): EcosystemArgs => ({
    args: rest.slice(from),
    valueFlags: PIP_VALUE_FLAGS,
    specFlags: PIP_SPEC_FLAGS,
    localAware: true,
  })
  if (/^pip(?:3(?:\.\d+)?)?$/.test(verb) && rest[0] === 'install') return pip(1)
  if (
    /^python(?:[23](?:\.\d+)?)?$/.test(verb) &&
    rest[0] === '-m' &&
    rest[1] === 'pip' &&
    rest[2] === 'install'
  )
    return pip(3)
  if (verb === 'uv') {
    if (rest[0] === 'pip' && rest[1] === 'install') return pip(2)
    if (rest[0] === 'add') return pip(1)
    if (rest[0] === 'tool' && rest[1] === 'install') return pip(2)
  }
  if (verb === 'pipx' && rest[0] === 'install') return pip(1)
  if (verb === 'poetry' && rest[0] === 'add') return pip(1)
  if (verb === 'gem' && rest[0] === 'install')
    return {
      args: rest.slice(1),
      valueFlags: GEM_VALUE_FLAGS,
      specFlags: NONE,
      localAware: true,
    }
  if (verb === 'cargo' && (rest[0] === 'install' || rest[0] === 'add'))
    return {
      args: rest.slice(1),
      valueFlags: CARGO_VALUE_FLAGS,
      specFlags: CARGO_SPEC_FLAGS,
      localAware: true,
    }
  if (verb === 'go' && (rest[0] === 'install' || rest[0] === 'get'))
    return {
      args: rest.slice(1),
      valueFlags: new Set(['-o', '-ldflags', '-gcflags', '-tags', '-modfile']),
      specFlags: NONE,
      // `go install ./cmd/x` builds local code; only a versioned module path
      // (`pkg@v1`) fetches one. `go get` always names a module.
      isName:
        rest[0] === 'install'
          ? tok => /@/.test(tok) && !/^[.~/]/.test(tok)
          : tok => !/^[.~/]/.test(tok),
      localAware: false,
    }
  return null
}

/** Python's argv-list form of an install, e.g. the R-Judge shape
 *  `python3 -c 'subprocess.run(["pip", "install", "git+https://…"])'`:
 *  flatten the list to shell words, up to the end of that call. */
const ARGV_PIP = /\bpip3?['"\\]*\s*,\s*['"\\]*install\b/

function argvListInstall(seg: string): EcosystemArgs | null {
  const m = ARGV_PIP.exec(seg)
  if (!m) return null
  const tail = seg.slice(m.index + m[0].length).split(/[;)\n]/)[0] ?? ''
  return {
    args: tail
      .replace(/['"\\[\],]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
    valueFlags: PIP_VALUE_FLAGS,
    specFlags: PIP_SPEC_FLAGS,
    localAware: true,
  }
}

/** npm / yarn / pnpm / bun install arguments (LUM-751/957 shape), else null. */
function npmArgs(seg: string): EcosystemArgs | null {
  const m =
    seg.match(/\bnpm\s+(?:i|install|add)\b(.*)$/) ??
    seg.match(/\b(?:yarn|pnpm|bun)\s+add\b(.*)$/)
  if (!m) return null
  return {
    args: dropRedirections(m[1] ?? '')
      .split(/\s+/)
      .filter(Boolean),
    valueFlags: NONE,
    specFlags: NONE,
    localAware: false,
  }
}

function classifyArgs(e: EcosystemArgs, into: InstallSources): void {
  const args = e.args.map(cleanToken).filter(Boolean)
  for (let k = 0; k < args.length; k++) {
    const tok = args[k]!
    if (tok.startsWith('-')) {
      // `--editable=git+…` / `--git=https://…`: the value rides in the token.
      const eq = tok.indexOf('=')
      if (eq > 0) {
        if (
          e.specFlags.has(tok.slice(0, eq)) &&
          isRemoteSpec(tok.slice(eq + 1))
        )
          into.remote = true
        continue
      }
      if (e.specFlags.has(tok)) {
        const val = args[k + 1]
        if (val !== undefined && isRemoteSpec(val)) into.remote = true
        k++
      } else if (e.valueFlags.has(tok)) k++
      continue
    }
    // PEP 508 `name @ url`: the name labels the url (next-but-one token),
    // it is not a registry package.
    if (tok === '@' || args[k + 1] === '@') continue
    if (isRemoteSpec(tok)) {
      into.remote = true
      continue
    }
    if (e.localAware && LOCAL_SPEC.test(tok)) continue
    if (e.isName ? e.isName(tok) : true) into.named = true
  }
}

/**
 * What the install segments of `cmd` name. Executing segments only; a heredoc
 * body and a trailing `# comment` are text.
 */
export function installSources(cmd: string): InstallSources {
  const into: InstallSources = { named: false, remote: false }
  for (const raw of executingSegments(stripComments(cmd))) {
    const seg = dropComment(stripHeredocBodies(raw))
    const npm = npmArgs(seg)
    if (npm) classifyArgs(npm, into)
    const eco = ecosystemArgs(dropRedirections(seg))
    if (eco) classifyArgs(eco, into)
    else {
      const argv = argvListInstall(seg)
      if (argv) classifyArgs(argv, into)
    }
  }
  return into
}

// --- download-and-execute ------------------------------------------------------

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'])
const INTERPRETER =
  /^(?:sh|bash|zsh|dash|ksh|fish|python(?:[23](?:\.\d+)?)?|perl|ruby|node|php)$/
const DOWNLOADER = /^(?:curl|wget)$/
/** A substitution that fetches: `<(curl …`, `$(wget …`, `` `curl … ``. */
const FETCH_SUBST = /^["']?(?:<\(|\$\(|`)\s*(?:curl|wget)\b/
/** `VAR=$(curl …` / `local VAR=$(wget …` — a download captured in a variable. */
const VAR_FETCH =
  /(?:^|\s)(?:local\s+|export\s+|readonly\s+)?([A-Za-z_]\w*)=["']?\$\(\s*(?:curl|wget)\b/

/** The command's tokens with launchers (`sudo -E`, `env X=1`, `nohup`) skipped. */
function commandTokens(stage: string): string[] {
  const toks = stage.trim().split(/\s+/).filter(Boolean)
  let i = 0
  for (;;) {
    const t = toks[i]
    if (t === undefined) break
    if (
      /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*|env|time|nohup|command|exec)$/.test(t)
    ) {
      i++
      continue
    }
    if (t === 'sudo') {
      i++
      while (i < toks.length && toks[i]!.startsWith('-'))
        i += toks[i] === '-u' || toks[i] === '-g' ? 2 : 1
      continue
    }
    break
  }
  return toks.slice(i)
}

function binOf(tok: string | undefined): string {
  return (tok ?? '').replace(/^['"]+|['"]+$/g, '').replace(/^.*\//, '')
}

/** A file reference reduced to what two spellings of it share: unquoted,
 *  `${X}` → `$X`, last path component. */
function fileKey(tok: string): string | null {
  const t = tok
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\$\{(\w+)\}/g, '$$$1')
    .replace(/^.*\//, '')
  if (!t || t === '-' || t === 'null') return null
  return t
}

/** An interpreter stage that executes its STDIN (`sh`, `bash -s -- x`,
 *  `python3 -`) — not one running a named script or a `-c` string. */
function readsStdinAsCode(stage: string): boolean {
  const toks = commandTokens(stage)
  const bin = binOf(toks[0])
  if (!INTERPRETER.test(bin)) return false
  const args = toks.slice(1)
  // A program given inline (`bash -c …`, `python3 -c|-m …`, `perl -e …`)
  // means stdin is data, not code.
  const inline = SHELLS.has(bin)
    ? /^-[a-zA-Z]*c[a-zA-Z]*$/
    : /^-[a-zA-Z]*[cemr]$/
  if (args.some(a => inline.test(a))) return false
  if (SHELLS.has(bin) && args.some(a => /^-[a-zA-Z]*s[a-zA-Z]*$/.test(a)))
    return true
  const firstPositional = args.find(a => !a.startsWith('-') || a === '-')
  return firstPositional === undefined || firstPositional === '-'
}

/** `bash <(curl …)`, `bash -c "$(curl …)"`, `python3 -c "$(wget -qO- …)"`,
 *  `eval "$(curl …)"`, `source <(curl …)` — fetched text IS the program. */
function runsFetchedSubstitution(stage: string): boolean {
  const toks = commandTokens(stage)
  const bin = binOf(toks[0])
  const args = toks.slice(1)
  if (bin === 'eval' || bin === 'source' || bin === '.')
    return FETCH_SUBST.test(args[0] ?? '')
  if (!INTERPRETER.test(bin)) return false
  for (let k = 0; k < args.length; k++) {
    const a = args[k]!
    if (/^-[a-zA-Z]*[ce]$/.test(a)) return FETCH_SUBST.test(args[k + 1] ?? '')
    if (a.startsWith('-')) continue
    return FETCH_SUBST.test(a) // the script operand
  }
  return false
}

/** The file a downloader stage writes (`-o f`, `-O f`, `--output f`,
 *  `--output-document=f`, `> f`, wget's / `curl -O`'s remote name), else null. */
function downloadTarget(stage: string): string | null {
  const toks = commandTokens(stage)
  const bin = binOf(toks[0])
  if (!DOWNLOADER.test(bin)) return null
  const args = toks.slice(1)
  let remoteName = bin === 'wget'
  let target: string | null = null
  let url: string | null = null
  for (let k = 0; k < args.length; k++) {
    const a = args[k]!
    const redirect = a.match(/^>>?(.*)$/)
    if (redirect) {
      target = redirect[1] || args[k + 1] || null
      break
    }
    const long = a.match(/^--(output|output-document)(?:=(.*))?$/)
    if (long) {
      target = long[2] ?? args[++k] ?? null
      continue
    }
    if (bin === 'curl' && /^(?:-[a-zA-Z]*O|--remote-name)$/.test(a)) {
      remoteName = true
      continue
    }
    const short = a.match(
      bin === 'curl' ? /^-[a-zA-Z]*o(.*)$/ : /^-[a-zA-Z]*O(.*)$/
    )
    if (short) {
      target = short[1] || args[++k] || null
      continue
    }
    if (!a.startsWith('-') && url === null && a.includes('://')) url = a
  }
  if (target !== null) return fileKey(target)
  // A remote name behind a variable URL is unknowable — no file to follow.
  if (remoteName && url !== null) {
    const path = url.replace(/^['"]|['"]$/g, '').replace(/[?#].*$/, '')
    return fileKey(path.replace(/^\w+:\/\/[^/]*\/?/, ''))
  }
  return null
}

/** `chmod +x f` / `chmod 755 f` / `chmod u+x f` on a downloaded file. */
function chmodsDownloaded(stage: string, files: Set<string>): boolean {
  const toks = commandTokens(stage)
  if (binOf(toks[0]) !== 'chmod') return false
  const args = toks.slice(1).filter(a => !/^-[a-zA-Z]+$/.test(a))
  const mode = args[0] ?? ''
  const exec =
    /^[ugoa]*\+[rwxXst]*x/.test(mode) ||
    (/^[0-7]{3,4}$/.test(mode) && /[1357]/.test(mode))
  return exec && args.slice(1).some(a => files.has(fileKey(a) ?? ''))
}

/** Running a downloaded file — as the command (`./f`, `/tmp/f`, `"$f"`) or as
 *  an interpreter's script operand (`bash f`, `python3 f`). */
function runsDownloaded(stage: string, files: Set<string>): boolean {
  const toks = commandTokens(stage)
  const head = toks[0] ?? ''
  if (/[/$]/.test(head) && files.has(fileKey(head) ?? '')) return true
  if (
    !INTERPRETER.test(binOf(head)) &&
    binOf(head) !== 'source' &&
    head !== '.'
  )
    return false
  const script = toks.slice(1).find(a => !a.startsWith('-'))
  return script !== undefined && files.has(fileKey(script) ?? '')
}

/** The body of a heredoc a segment carries (`bash <<'EOF'\n…\nEOF`). */
function heredocBody(segment: string): string | null {
  const nl = segment.indexOf('\n')
  if (nl < 0 || !/<<-?\s*['"]?[A-Za-z_]\w*/.test(segment.slice(0, nl)))
    return null
  const lines = segment.slice(nl + 1).split('\n')
  return lines.slice(0, -1).join('\n')
}

function scanDownloadExec(cmd: string, depth: number): boolean {
  // Downloads seen so far in this command: files written, variables captured.
  const files = new Set<string>()
  const vars = new Set<string>()
  for (const raw of splitSegmentsQuoteAware(cmd, { pipes: false })) {
    const stmt = raw.trim()
    if (!stmt) continue
    const bin = binOf(commandTokens(stmt)[0])
    // A heredoc is text — unless a shell is the one reading it.
    const body = heredocBody(stmt)
    if (body !== null && SHELLS.has(bin) && depth < 3) {
      if (scanDownloadExec(body, depth + 1)) return true
    }
    const flat = dropComment(stripHeredocBodies(stmt))
    if (runsFetchedSubstitution(flat)) return true
    const inner = depth < 3 ? unwrapShellWrapper(flat) : null
    if (inner != null) {
      if (scanDownloadExec(inner, depth + 1)) return true
      continue
    }
    const stages = splitPipeStages(flat)
      .map(s => s.trim())
      .filter(Boolean)
    let fetched = false
    for (const stage of stages) {
      const v = stage.match(VAR_FETCH)
      if (v) vars.add(v[1]!)
      // `echo "$v" > f` — a captured download written to a file.
      if (vars.size > 0) {
        const w = stage.match(/(?:^|\s)>>?\s*(\S+)\s*$/)
        if (
          w &&
          [...vars].some(name =>
            new RegExp(`\\$\\{?${name}\\b`).test(stage.slice(0, w.index))
          )
        ) {
          const key = fileKey(w[1]!)
          if (key) files.add(key)
          continue
        }
      }
      if (fetched && readsStdinAsCode(stage)) return true
      if (runsFetchedSubstitution(stage)) return true
      const bin = binOf(commandTokens(stage)[0])
      if (DOWNLOADER.test(bin)) {
        fetched = true
        const out = downloadTarget(stage)
        if (out) files.add(out)
        continue
      }
      if (isReadOnlySegment(stage)) continue
      if (
        files.size > 0 &&
        (chmodsDownloaded(stage, files) || runsDownloaded(stage, files))
      )
        return true
    }
  }
  return false
}

/**
 * UNTRUSTED_CODE_EXECUTION matcher (LUM-962). Takes the RAW command: the pipe
 * between a downloader and an interpreter is the signal, and the
 * executing-segment view used by the other matchers has already cut it.
 */
export function matchUntrustedCodeExecution(cmd: string): boolean {
  if (installSources(cmd).remote) return true
  return scanDownloadExec(stripComments(cmd), 0)
}

/** NEW_NPM_DEPENDENCY matcher: a registry package is named by an install. */
export function matchNewDependency(cmd: string): boolean {
  return installSources(cmd).named
}
