/**
 * LUM-758 §5.4 — 沙箱 agent 的命令闸门。这道闸门后面是一个用 GitHub installation
 * token 拉下来的 checkout，输入由**不可信的 PR 内容**驱动的 LLM 产生：默认假设每
 * 条命令都是敌意的。
 *
 * **设计要点：白名单字符，而不是黑名单构造。**
 * `lib/boundary-crossing/command-shape.ts` 自述「a missed split only ever leaves
 * MORE text in a segment, erring toward flagging」——这条性质对**检测器**是安全
 * 的，对**白名单闸门则完全反转**：两层判定都只看 token[0]，段里多出来的尾巴
 * （`cat x & curl …` 里的 `curl …`）反而会被一起放行。所以这里不再逐个去认
 * `&` / `` ` `` / `<(` 这些构造（认漏一个就是一次 RCE），而是反过来：**一段里
 * 只要出现引号外的、不在安全字符集里的字符，就直接拒**。新的 shell 元字符天然
 * 落在安全集之外，默认被拒。
 *
 * 三层，顺序固定：
 *   1. 拆段：顶层用 `splitSegmentsQuoteAware` 按 `;`/`&&`/`||`/`|`/换行切分
 *      （引号感知），`bash -c '…'` 之类的壳包装用 `unwrapShellWrapper` 递归展开，
 *      藏在参数里的 `$(...)` / `` `...` `` 命令替换额外单独抽取出来再走一遍同样的
 *      流程——分词仍然 100% 委托给 LUM-751 的纯函数，不重新发明分词器。
 *   2. 逐段：引号感知扫描一次（`scanSegment`），同时产出 token 和「引号外的第一个
 *      不安全字符」。重定向 `>`、后台 `&`、进程替换 `<(`、反引号、`$`、`{}` 等
 *      全部由这一个扫描覆盖，不再各写一个探测器。
 *   3. 逐段：先 `isReadOnlySegment`（只读吗），**再**命令名白名单
 *      （`HUNT_SHELL_COMMANDS`，且不接受任何带 `/` 的路径），最后按命令做
 *      **参数级**闸门（`sed -i`、`sed` 脚本里的 `e`/`w`、`rg --pre`、
 *      `ast-grep -U` 这些「用允许的动词干写/执行」的旗标）。
 *
 * 第 3 层的两小层不能合并：`isReadOnlySegment` 只回答「是不是只读」，不回答
 * 「是不是我们允许的工具」—— `git log` / `git status` 是只读的，但 agent 不该
 * 拿到完整的 git。
 *
 * 注意：这里**没有**复用 `executingSegments`。那个函数会把 `git status`（只读）
 * 整段丢弃，于是我们就再也看不到它，无法拿命令名去比对这张更窄的白名单。
 *
 * 纯函数，无 I/O：单测直接覆盖，不需要沙箱。
 */
import {
  isReadOnlySegment,
  splitSegmentsQuoteAware,
  unwrapShellWrapper,
} from '@/lib/boundary-crossing/command-shape'

/** 只读检索工具。`head`/`tail`/`wc` 是管道收尾的常用件，同样只读。 */
export const HUNT_SHELL_COMMANDS: readonly string[] = [
  'rg',
  'grep',
  'sed',
  'cat',
  'ast-grep',
  'head',
  'tail',
  'wc',
]

export type HuntCommandCheck = { ok: true } | { ok: false; reason: string }

const ALLOWED_LIST = HUNT_SHELL_COMMANDS.join(', ')
const MAX_SUBSTITUTION_DEPTH = 5
const MAX_WRAPPER_DEPTH = 3
const ECHO_LIMIT = 120

/**
 * 引号外允许出现的字符（空白单独处理）。**白名单**：任何没列进来的字符——
 * `&` `` ` `` `<` `>` `(` `)` `$` `{` `}` `;` `|` `!` 换行 以及将来任何新元字符
 * ——都会被 `scanSegment` 判为不安全。要放行一个新字符，必须在这里显式加。
 * 非 ASCII（>0x7f）一律放行：shell 元字符全在 ASCII 里，而中文等文件名合法。
 */
const SAFE_UNQUOTED_CHAR = /^[A-Za-z0-9_\-.\/=,:+@%^~#[\]*?]$|^[^\x00-\x7f]$/

type SegmentScan = {
  /** 去掉引号 / 反斜杠转义后的实参（shell 真正会交给程序的那些）。 */
  tokens: string[]
  /** 引号外第一个不在 `SAFE_UNQUOTED_CHAR` 里的字符，没有则 null。 */
  unsafe: string | null
  /** 引号没闭合——无法判断后面是不是引号内，按失败关闭处理。 */
  unbalancedQuote: boolean
}

/**
 * 一次引号感知的遍历，同时产出分词结果和「引号外的不安全字符」。这是本文件唯一
 * 的字符级扫描器：重定向检测、元字符检测、旗标解析都读它的输出，不各自再写一遍
 * 引号状态机。
 *
 * 反引号即使出现在**双引号里**也会被 shell 展开，所以它在双引号内同样算不安全
 * （单引号内是字面量，安全）。
 */
function scanSegment(segment: string): SegmentScan {
  const tokens: string[] = []
  let unsafe: string | null = null
  let cur = ''
  let started = false
  let quote: '"' | "'" | null = null
  const flush = () => {
    if (started) tokens.push(cur)
    cur = ''
    started = false
  }
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!
    if (quote) {
      if (c === '\\' && quote === '"' && i + 1 < segment.length) {
        cur += segment[++i]!
        continue
      }
      if (c === quote) {
        quote = null
        continue
      }
      if (c === '`' && quote === '"' && unsafe === null) unsafe = '`'
      cur += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      started = true
      continue
    }
    if (c === '\\' && i + 1 < segment.length) {
      cur += segment[++i]!
      started = true
      continue
    }
    if (/\s/.test(c)) {
      flush()
      continue
    }
    if (unsafe === null && !SAFE_UNQUOTED_CHAR.test(c)) unsafe = c
    cur += c
    started = true
  }
  flush()
  return { tokens, unsafe, unbalancedQuote: quote !== null }
}

/**
 * 抽取段内所有命令替换的内容（`$(...)` 和 `` `...` ``，含嵌套）。单引号内的内容
 * 按 shell 语义不会被替换，直接跳过；双引号内仍会展开，正常扫描。
 */
function extractSubstitutions(text: string): string[] {
  const out: string[] = []
  const push = (inner: string) => {
    out.push(inner)
    out.push(...extractSubstitutions(inner))
  }
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (c === "'") {
      const end = text.indexOf("'", i + 1)
      i = end === -1 ? text.length : end + 1
      continue
    }
    if (c === '\\' && i + 1 < text.length) {
      i += 2
      continue
    }
    if (c === '`') {
      let j = i + 1
      while (j < text.length && text[j] !== '`') {
        j += text[j] === '\\' && j + 1 < text.length ? 2 : 1
      }
      push(text.slice(i + 1, Math.min(j, text.length)))
      i = j + 1
      continue
    }
    if (c === '$' && text[i + 1] === '(') {
      let depth = 1
      let j = i + 2
      while (j < text.length && depth > 0) {
        const cj = text[j]!
        if (cj === "'") {
          const end = text.indexOf("'", j + 1)
          j = end === -1 ? text.length : end + 1
          continue
        }
        if (cj === '\\' && j + 1 < text.length) {
          j += 2
          continue
        }
        if (cj === '(') depth++
        else if (cj === ')') depth--
        j++
      }
      push(text.slice(i + 2, Math.max(j - 1, i + 2)))
      i = j
      continue
    }
    i++
  }
  return out
}

/** sed 脚本里**只读**的单字符命令。`e`/`w`/`W`/`r`/`R`/`a`/`i`/`c`/`{` 等一律不在。 */
const SAFE_SED_COMMANDS = new Set([
  'p',
  'P',
  'd',
  'D',
  '=',
  'q',
  'Q',
  'n',
  'N',
  'h',
  'H',
  'g',
  'G',
  'x',
  'l',
  'z',
  'F',
])

/**
 * 保守解析一条 sed 脚本：只接受「可选地址 + 只读命令」和 `s///`/`y///`（替换标志
 * 里不得有 `e`/`w`）。语法一旦超出这张表——块 `{}`、标签、`e`/`w`/`r`、无法确定
 * 分隔符的 `s` 命令——**一律判为不安全**（失败关闭），不去猜。
 */
function isSafeSedScript(script: string): boolean {
  let i = 0
  const n = script.length
  const readUntil = (delim: string): boolean => {
    while (i < n) {
      const c = script[i]!
      if (c === '\\' && i + 1 < n) {
        i += 2
        continue
      }
      if (c === delim) {
        i++
        return true
      }
      if (c === '\n') return false
      i++
    }
    return false
  }
  /** true=读到地址, null=此处没有地址, false=语法不可信 */
  const readAddress = (): boolean | null => {
    const c = script[i]
    if (c === undefined) return null
    if (/[0-9]/.test(c)) {
      while (i < n && /[0-9]/.test(script[i]!)) i++
      if (script[i] === '~') {
        i++
        if (!/[0-9]/.test(script[i] ?? '')) return false
        while (i < n && /[0-9]/.test(script[i]!)) i++
      }
      return true
    }
    if (c === '$') {
      i++
      return true
    }
    if (c === '/') {
      i++
      return readUntil('/') ? true : false
    }
    if (c === '\\') {
      const d = script[i + 1]
      if (d === undefined) return false
      i += 2
      return readUntil(d) ? true : false
    }
    return null
  }
  const skipSeparators = () => {
    while (i < n && (/\s/.test(script[i]!) || script[i] === ';')) i++
  }
  const endOfCommand = (): boolean => {
    while (i < n && /[ \t]/.test(script[i]!)) i++
    if (i >= n) return true
    const c = script[i]!
    if (c === ';' || c === '\n') {
      i++
      return true
    }
    return false
  }
  while (true) {
    skipSeparators()
    if (i >= n) return true
    const addr = readAddress()
    if (addr === false) return false
    if (addr) {
      while (i < n && /[IM]/.test(script[i]!)) i++
      if (script[i] === ',') {
        i++
        if (readAddress() !== true) return false
        while (i < n && /[IM]/.test(script[i]!)) i++
      }
    }
    while (i < n && script[i] === '!') i++
    while (i < n && /[ \t]/.test(script[i]!)) i++
    const cmd = script[i]
    if (cmd === undefined) return false
    i++
    if (cmd === 's' || cmd === 'y') {
      const delim = script[i]
      if (delim === undefined || /[\\\n\sA-Za-z0-9]/.test(delim)) return false
      i++
      if (!readUntil(delim)) return false
      if (!readUntil(delim)) return false
      if (cmd === 's') {
        while (i < n && /[gpiImM0-9]/.test(script[i]!)) i++
        // `e`（执行替换结果）/ `w`（写文件）正是我们要拦的两个标志。
        if (i < n && /[A-Za-z]/.test(script[i]!)) return false
      }
      if (!endOfCommand()) return false
      continue
    }
    if (!SAFE_SED_COMMANDS.has(cmd)) return false
    while (i < n && /[0-9]/.test(script[i]!)) i++
    if (!endOfCommand()) return false
  }
}

/** sed 的安全短旗标（`e` 单独处理，`i`/`f` 单独拒）。 */
const SED_SHORT_FLAGS = 'nszEru'
const SED_LONG_FLAGS = new Set([
  '--quiet',
  '--silent',
  '--null-data',
  '--zero-terminated',
  '--regexp-extended',
  '--separate',
  '--posix',
  '--sandbox',
  '--unbuffered',
  '--debug',
])

function sedGate(args: readonly string[]): string | null {
  const scripts: string[] = []
  let scriptTaken = false
  let endOfFlags = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (!endOfFlags && arg.startsWith('-') && arg !== '-') {
      if (arg === '--') {
        endOfFlags = true
        continue
      }
      if (arg.startsWith('--')) {
        const eq = arg.indexOf('=')
        const name = eq === -1 ? arg : arg.slice(0, eq)
        if (name === '--expression') {
          if (eq !== -1) scripts.push(arg.slice(eq + 1))
          else {
            const value = args[++i]
            if (value === undefined) return "sed '--expression' has no script"
            scripts.push(value)
          }
          scriptTaken = true
          continue
        }
        if (name === '--in-place') {
          return "sed '--in-place' rewrites files; this sandbox is read-only"
        }
        if (name === '--file') {
          return "sed '--file' runs a script this gate cannot inspect; not allowed"
        }
        if (!SED_LONG_FLAGS.has(name))
          return `sed flag '${name}' is not allowed`
        continue
      }
      const letters = arg.slice(1)
      for (let k = 0; k < letters.length; k++) {
        const ch = letters[k]!
        if (ch === 'e') {
          const rest = letters.slice(k + 1)
          if (rest) scripts.push(rest)
          else {
            const value = args[++i]
            if (value === undefined) return "sed '-e' has no script"
            scripts.push(value)
          }
          scriptTaken = true
          break
        }
        if (ch === 'i') {
          return "sed '-i' rewrites files in place; this sandbox is read-only"
        }
        if (ch === 'f') {
          return "sed '-f' runs a script this gate cannot inspect; not allowed"
        }
        if (!SED_SHORT_FLAGS.includes(ch)) {
          return `sed flag '-${ch}' is not allowed`
        }
      }
      continue
    }
    if (!scriptTaken) {
      scripts.push(arg)
      scriptTaken = true
    }
  }
  if (scripts.length === 0) return 'sed needs an explicit script'
  for (const script of scripts) {
    if (!isSafeSedScript(script)) {
      return `sed script is not a plainly read-only script (no 'e', 'w', 'r' or block commands): ${script.slice(0, 60)}`
    }
  }
  return null
}

/** rg 旗标里会启动外部程序的那些。 */
const RG_DENIED_FLAGS = new Set(['--pre', '--hostname-bin', '--search-zip'])

function rgGate(args: readonly string[]): string | null {
  for (const arg of args) {
    const name = arg.startsWith('--') ? arg.split('=')[0]! : arg
    if (RG_DENIED_FLAGS.has(name)) {
      return `rg flag '${name}' runs an external program; not allowed`
    }
    if (/^-[A-Za-z]*z/.test(arg)) {
      return "rg flag '-z' runs an external decompressor; not allowed"
    }
  }
  return null
}

/** ast-grep 旗标里会改写文件的那些。 */
const AST_GREP_DENIED_FLAGS = new Set([
  '--update-all',
  '--rewrite',
  '--interactive',
])

function astGrepGate(args: readonly string[]): string | null {
  for (const arg of args) {
    const name = arg.startsWith('--') ? arg.split('=')[0]! : arg
    if (AST_GREP_DENIED_FLAGS.has(name)) {
      return `ast-grep flag '${name}' rewrites files; this sandbox is read-only`
    }
    if (/^-[A-Za-z]*[Uri]/.test(arg) && !arg.startsWith('--')) {
      return `ast-grep flag '${arg}' rewrites files; this sandbox is read-only`
    }
  }
  return null
}

/** 允许的动词里，哪些旗标会把「只读检索」变成写/执行。 */
const FLAG_GATES: Record<string, (args: readonly string[]) => string | null> = {
  sed: sedGate,
  rg: rgGate,
  'ast-grep': astGrepGate,
}

function checkSegment(segment: string, depth: number): HuntCommandCheck {
  const echo = segment.slice(0, ECHO_LIMIT)
  const scan = scanSegment(segment)
  // 先递归命令替换：这样 `cat $(curl …)` 报的是里面那条命令，比「有个 `$`」有用。
  for (const substitution of extractSubstitutions(segment)) {
    const nested = checkCommandText(substitution, depth + 1)
    if (!nested.ok) return nested
  }
  if (scan.unbalancedQuote) {
    return { ok: false, reason: `segment has an unbalanced quote: ${echo}` }
  }
  if (scan.unsafe !== null) {
    return {
      ok: false,
      reason: `segment uses the shell metacharacter '${scan.unsafe}' outside quotes; quote it or drop it: ${echo}`,
    }
  }
  if (!isReadOnlySegment(segment)) {
    return { ok: false, reason: `segment is not read-only: ${echo}` }
  }
  const name = scan.tokens[0] ?? ''
  // 路径前缀会指向 PR checkout 里自带的可执行文件（git 保留 755），`./tools/cat`
  // 一样能通过按名字比对的白名单。沙箱 PATH 上就是真工具，不需要路径。
  if (name.includes('/')) {
    return {
      ok: false,
      reason: `command must be a bare name on PATH, not a path: '${name.slice(0, 60)}'`,
    }
  }
  if (!HUNT_SHELL_COMMANDS.includes(name)) {
    return {
      ok: false,
      reason: `command '${name}' is not allowed; allowed: ${ALLOWED_LIST}`,
    }
  }
  const gate = FLAG_GATES[name]
  if (gate) {
    const denial = gate(scan.tokens.slice(1))
    if (denial) return { ok: false, reason: denial }
  }
  return { ok: true }
}

/**
 * 顶层可执行段：引号感知分割 + 递归展开 `bash -c '…'` 包装。**不**丢弃只读段
 * ——和 `executingSegments` 唯一的区别，也是本文件必须自己做这一步 glue 的
 * 原因：分词本身仍然 100% 委托给 `splitSegmentsQuoteAware` /
 * `unwrapShellWrapper`。
 */
function topLevelSegments(cmd: string, depth = 0): string[] {
  const out: string[] = []
  for (const raw of splitSegmentsQuoteAware(cmd)) {
    const seg = raw.trim()
    if (!seg) continue
    const inner = depth < MAX_WRAPPER_DEPTH ? unwrapShellWrapper(seg) : null
    if (inner != null) {
      out.push(...topLevelSegments(inner, depth + 1))
      continue
    }
    out.push(seg)
  }
  return out
}

function checkCommandText(cmd: string, depth: number): HuntCommandCheck {
  if (depth > MAX_SUBSTITUTION_DEPTH) {
    return { ok: false, reason: 'command nesting is too deep' }
  }
  const segments = topLevelSegments(cmd)
  if (segments.length === 0) return { ok: false, reason: 'empty command' }
  for (const segment of segments) {
    const result = checkSegment(segment, depth)
    if (!result.ok) return result
  }
  return { ok: true }
}

export function checkHuntCommand(cmd: string): HuntCommandCheck {
  return checkCommandText(cmd, 0)
}
