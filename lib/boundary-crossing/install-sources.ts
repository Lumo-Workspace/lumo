/**
 * LUM-1063 — the install-segment parser of LUM-962, moved verbatim out of
 * `untrusted-code.ts` into the core: NEW_NPM_DEPENDENCY ("names a new
 * registry package") is a core baseline category, while the
 * UNTRUSTED_CODE_EXECUTION matcher that also reads `installSources(...).remote`
 * is a plugin detector. Pure, no I/O.
 *
 * What it answers, from the command text alone:
 *   - does a segment install a NEW package by name from a registry
 *     (`npm i x`, `pip install x`, `uv add x`, `gem install x`, `cargo
 *     install x`, `go install x@v` …)? → `named` (NEW_NPM_DEPENDENCY);
 *   - does it install from a VCS / URL source (`pip install git+https://…`,
 *     `npm i github:u/r`, `cargo install --git …`)? → `remote` (read by the
 *     plugin's UNTRUSTED_CODE_EXECUTION matcher).
 *
 * Only EXECUTING segments count (LUM-751/772): echo / grep / cat / lumo /
 * gh-authoring carriers and `git commit` messages are text, a heredoc body is
 * text, and a `#` comment is ignored.
 */
import { stripHeredocBodies } from './prose'
import { executingSegments } from './command-shape'

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
export function dropComment(seg: string): string {
  return seg.replace(/(?:^|\s)#[\s\S]*$/, '')
}

/** Drop every unquoted `# comment` up to its newline BEFORE splitting into
 *  segments — a comment swallows any `&&` / `|` after it on that line. */
export function stripComments(cmd: string): string {
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

/** NEW_NPM_DEPENDENCY matcher: a registry package is named by an install. */
export function matchNewDependency(cmd: string): boolean {
  return installSources(cmd).named
}
