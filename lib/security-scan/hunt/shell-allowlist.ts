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
 *      流程——分词仍然 100% 委托给 LUM-751 的纯函数，不重新发明分词器。展开壳包装
 *      时**整段被内层脚本替换掉**，所以只有形状严格（闭合引号后一个字符都没有）
 *      的包装才准展开，否则原段留下来照常受审，见 `strictWrapperInner`。
 *   2. 逐段：引号感知扫描一次（`scanSegment`），同时产出 token 和「引号外的第一个
 *      不安全字符」。重定向 `>`、后台 `&`、进程替换 `<(`、反引号、`$`、`{}` 等
 *      全部由这一个扫描覆盖，不再各写一个探测器。
 *   3. 逐段：先 `isReadOnlySegment`（只读吗），**再**命令名白名单
 *      （`HUNT_SHELL_COMMANDS`，且不接受任何带 `/` 的路径），最后按命令做
 *      **参数级**闸门（`sed -i`、`sed` 脚本里的 `e`/`w`、`rg --pre` 这些
 *      「用允许的动词干写/执行」的旗标）。
 *
 * 一条贯穿三层的教训（LUM-758 两轮复盘）：**任何一个构造都必须至少有一层完整地
 * 认得它，两层之间不能互相假设对方会兜底**。双引号里的 `$(…)` 曾经被 `scanSegment`
 * 全权委托给 `extractSubstitutions`，而后者不认双引号；壳包装的尾巴曾经被
 * `topLevelSegments` 整段丢掉，而字符白名单根本没机会看见它——两次都是「以为对方
 * 守着」。第三轮把这条推广了一步：闸门不但要认得 shell **会执行**的东西，还要认得
 * shell **会丢掉**的东西——`#` 注释让 shell 丢掉半行，闸门却接着读，两边的引号 /
 * 续行状态就此分叉，换行之后的命令一条都没被审过。
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

/**
 * 只读检索工具。`head`/`tail`/`wc` 是管道收尾的常用件，同样只读。
 *
 * LUM-782 — this list is the SINGLE source for "what the agent may run": the
 * `run_shell` tool description is derived from it (`describeRunShellTool`),
 * and every entry is probed on the VM at start-up (`probeHuntTools`) through
 * the commands in `HUNT_SHELL_PROBES` below. `ast-grep` used to be here: it was
 * allowed, recommended to the model, and never installed in
 * `vercel/sandbox/universal` (live probe 2026-09-14: exit 127; the image's
 * Dockerfile installs `ripgrep` and no ast-grep) — the agent spent steps on a
 * tool that did not exist. Removed rather than installed: its canonical
 * `$A` / `$$$` patterns fight the double-quote rule of this gate, and text
 * search is what the sandbox actually has.
 */
export const HUNT_SHELL_COMMANDS: readonly string[] = [
  'rg',
  'grep',
  'sed',
  'cat',
  'head',
  'tail',
  'wc',
  // LUM-787 follow-up (user decision): the first production rerun on the
  // bounded loop was refused on `ls` and `find` — the model's own words for
  // "what is in this directory", which the prompt forbade without offering
  // a substitute. Both are read-only listers; `find` carries executing and
  // deleting flags, which `findGate` below refuses by name (and
  // `isReadOnlySegment` refuses independently — two layers, as always).
  'ls',
  'find',
  // …and the rest of the refusals the first 60 production scans recorded
  // (28 of 425 commands): `echo` as a separator between chained reads,
  // `pwd`, and the pipeline finishers `sort` / `uniq` / `cut`. All print to
  // stdout only — `sort -o` / `--output` writes a file and `sortGate`
  // refuses it. `awk` stays out: its scripts can run programs and write
  // files, and would need a script gate like `sed`'s.
  'echo',
  'pwd',
  'sort',
  'uniq',
  'cut',
  // LUM-787 follow-up (user decision, with every command now recorded in
  // the audit): `git` limited to read-only subcommands by `gitGate` — the
  // checkout is a depth-1 clone, so there is no history to diff against,
  // but `log`/`show`/`blame`/`ls-files`/`grep` answer real questions — and
  // `awk` limited by `awkGate` to scripts that neither run programs
  // (`system`, `getline` from a command) nor write (`>`, `|`).
  'git',
  'awk',
]

/**
 * LUM-782 — one start-up probe per allowlisted tool, run BEFORE the agent's
 * first step on the same VM it will use. Each probe is an ordinary allowlisted
 * command: it goes through `checkHuntCommand` and the same `sh -c` choke point
 * as an agent command (no back door for our own commands), and a shell that
 * cannot find the binary answers exit 127. `--version` everywhere except
 * `sed`, whose flag gate only admits the read-only flags it knows: `-n p` over
 * /dev/null prints nothing and exits 0 on GNU and uutils sed alike.
 * `shell-allowlist.test.ts` pins that the keys are exactly
 * `HUNT_SHELL_COMMANDS` and that every probe passes the gate.
 */
export const HUNT_SHELL_PROBES: Readonly<Record<string, string>> = {
  rg: 'rg --version',
  grep: 'grep --version',
  sed: 'sed -n p /dev/null',
  cat: 'cat --version',
  head: 'head --version',
  tail: 'tail --version',
  wc: 'wc --version',
  ls: 'ls --version',
  find: 'find --version',
  echo: 'echo ok',
  pwd: 'pwd',
  sort: 'sort --version',
  uniq: 'uniq --version',
  cut: 'cut --version',
  // `git log -0` rather than `--version`: the read-only classifier needs a
  // subcommand to judge, and `-0` prints nothing.
  git: 'git log -0',
  awk: "awk 'BEGIN{exit 0}'",
}

/**
 * LUM-787 follow-up — the ONLY exception to the character whitelist below:
 * an unquoted glob (`*`, `?`, `[…]`) is admitted when the segment's command
 * is one whose argv cannot turn a FILE NAME into an action. The fifth review
 * round's attack still stands for every other tool: a PR adds a file named
 * `--pre=sh` (a legal git path), `rg -n x *` expands it into rg's
 * program-running flag, and the flag gates never see the expansion because
 * they read the written tokens, not the shell's argv. `cat`, `head`, `tail`,
 * `wc`, `ls`, `grep`, `echo`, `cut` and `uniq` have no flag that executes or
 * writes, so an expanded name can at worst be misread as an option that
 * prints or fails. `rg`, `sed`, `find`, `sort`, `git` and `awk` do — for
 * them the glob must be quoted (`rg -g "*.ts"`), which the tool description
 * says.
 */
const GLOB_SAFE_COMMANDS = new Set([
  'cat',
  'head',
  'tail',
  'wc',
  'ls',
  'grep',
  'echo',
  'cut',
  'uniq',
])
const GLOB_CHARS = new Set(['*', '?', '[', ']'])

/**
 * LUM-787 follow-up — the two redirections that only ever discard or merge
 * stderr. Recognised as whole, unquoted, whitespace-delimited tokens at a
 * token boundary and dropped from the argv the flag gates see (the shell
 * consumes them too). Any other `>` stays a refusal.
 */
const STDERR_REDIRECT_TOKENS = ['2>/dev/null', '2>&1'] as const

/**
 * LUM-758 Task 9 — **the shell this gate was written against**, and the only
 * one a caller may run a checked command in. It lives here, next to the
 * parser, because the two are one artefact: four review rounds (the last a
 * differential fuzzer run against real bash, zsh and sh) tuned `scanSegment`
 * to what a NON-INTERACTIVE, NON-LOGIN POSIX shell does with a string.
 *
 * `sh -c <cmd>` and nothing else:
 *   - `-l` (`bash -lc`) sources `/etc/profile` and `~/.*rc`, which can set
 *     `shopt -s extglob` / zsh's `EXTENDED_GLOB` and define aliases and
 *     functions — every one of those changes what the SAME string means,
 *     which is exactly the ground the fuzzer stands on.
 *   - `-i` adds history expansion (`!`), another meaning the gate's character
 *     whitelist assumes is unreachable.
 *   - Two argv entries exactly: the command must arrive as ONE argument,
 *     byte-identical to what `checkHuntCommand` read. Concatenating,
 *     re-quoting or interpolating it between the check and the run voids the
 *     check — the gate would have parsed a different string than the one that
 *     runs.
 * `__tests__/security-scan/hunt/shell-exec-boundary.test.ts` holds this.
 */
export const HUNT_SHELL_BIN = 'sh'
export const HUNT_SHELL_FLAG = '-c'

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
 *
 * `#` 留在集合里，但**只在词中**安全（`foo#bar`、`rg -n \#foo`）：词首的 `#` 是
 * 注释，由 `scanSegment` 单独判不安全，见那里的注释。`^` 曾经在这个集合里——没有
 * 任何检索需要它不加引号（行首锚点写在引号里：`rg -n "^import" lib/`），而 zsh
 * 开了 `EXTENDED_GLOB` 后 `^x` 是否定 glob，属于「看着人畜无害」的那一类，和 `#`
 * 同科，已移除。
 *
 * glob 的四个字符 `*` `?` `[` `]` 曾经**被有意放进来**（「它们又不执行什么」），
 * 第五轮复盘把它们移了出去：`scanSegment` 分词的是**写下来的那串字面量**，而
 * `sh -c` 执行的是**展开之后的 argv**——于是逐工具的旗标闸门（`rgGate` /
 * `sedGate`）审的和跑的根本不是同一组实参。被审 PR 只要加一个叫
 * `--pre=sh` 的文件（合法 git 路径，不含 `/`），模型写下 `rg -n queryRaw *`，
 * shell 展开后 rg 拿到的就是 `RG_DENIED_FLAGS` 专门要拦的那个旗标，对着 PR 自带
 * 的内容执行 `sh`；`sed -i` 同形。hunt **attach 到托管扫描那台 VM** 时出网是
 * 故意不封的（封了 semgrep 下载就断），所以这条是私有 checkout 的外泄，不只是
 * 本地执行。这不是「将来某个新元字符」那一类（那类天然落在白名单外，闸门的收敛
 * 性论证覆盖得住），而是本分支已经关掉的「审的串 == 跑的串」不变式在 **argv
 * 一级**的孪生体。引号里的 glob 照常放行（`rg -g '!*.test.ts'`、
 * `rg --pre-glob "*.md"`）——shell 不展开引号里的
 * glob，被审的串和被执行的 argv 仍然一致，真实检索也确实需要它们。
 */
const SAFE_UNQUOTED_CHAR = /^[A-Za-z0-9_\-.\/=,:+@%~#]$|^[^\x00-\x7f]$/

type SegmentScan = {
  /** 去掉引号 / 反斜杠转义后的实参（shell 真正会交给程序的那些）。 */
  tokens: string[]
  /** LUM-787 — 引号外的第一个 glob 字符（`*` `?` `[` `]`），没有则 null。是否
   *  放行由 `checkSegment` 按命令名决定（`GLOB_SAFE_COMMANDS`）。 */
  glob: string | null
  /** 不安全字符（引号外的，或双引号内仍会被 shell 展开的 `` ` ``/`$`），没有则
   *  null。 */
  unsafe: string | null
  /** `unsafe` 是在双引号**内部**发现的（`` ` ``/`$(`/`${…}` 这类双引号挡不住的
   *  展开）。理由文案要按这个字段分岔——「outside quotes」对这种情况是假话：
   *  第三轮复盘发现的那句理由字面上就在说反话，模型被指去做它已经做过的事
   *  （见 checkSegment 里的两条理由）。 */
  unsafeInDoubleQuote: boolean
  /** 引号没闭合——无法判断后面是不是引号内，按失败关闭处理。 */
  unbalancedQuote: boolean
}

/**
 * 双引号里的 `$` 什么时候只是个字面美元号。四种放行：
 *   - `$name`（`rg -n "$HOME" lib/` 这类普通变量引用，不会执行什么）；
 *   - `${name}`，且**整个花括号形状必须严格匹配**（`grep -n "${HOME}"`）——
 *     只看开头一个字符曾经是三轮复盘之前的老 bug（第四轮复盘）：`${x@P}`
 *     （bash≥4.4 把 `x` 的值当 prompt 串重新展开，会执行命令替换）、
 *     `${x[y]}`、`${x:-…}`、`${x//a/b}` 全部以 `{` 加字母开头，逐字符扫描只看
 *     `{` 后第一个字符时，这些花括号运算符的**整个函数体**会落回旧的「反引号 /
 *     `$(` 两项黑名单」，正是第三轮想替换掉的东西。改成整体匹配
 *     `{name}`（`name` 只能是 `[A-Za-z_][A-Za-z0-9_]*`），别的花括号形状一律
 *     判不安全。今天这条闸门前面还拿不到变量赋值，但沙箱调用方一旦把 PR 数据
 *     导出成 env（refname 合法含 `$`/`(`/`)`/`;`），`${x@P}` 就是现成的 RCE。
 *   - 紧贴右引号或段尾的 `$`（`rg -n "foo$"` 的正则行尾锚点）——任何 shell 都不会
 *     拿它去展开什么；
 *   - 紧跟 `|` 的 `$`（`rg -n "a$|b" lib/` 的行尾锚点 + 分支）——`$|` 在 bash /
 *     zsh / sh / dash 里都不是任何特殊参数（`$@ $* $# $? $- $$ $! $0-9` 之外，
 *     `$` 后接非字母数字/`_`/`{`/`(` 的字符从不触发展开），和紧贴段尾同理安全，
 *     加进来是为了不再拒绝这个常见的 ripgrep 写法。
 * 其余一律不安全。这里是**字符白名单**而不是「认 `$(` 和反引号」的两项黑名单。
 */
function isLiteralDollar(text: string, i: number): boolean {
  const next = text[i + 1]
  if (next === undefined || next === '"' || next === '|') return true
  if (/[A-Za-z_]/.test(next)) return true
  if (next === '{') return /^\{[A-Za-z_][A-Za-z0-9_]*\}/.test(text.slice(i + 1))
  return false
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
  let glob: string | null = null
  let unsafeInDoubleQuote = false
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
      // 双引号内 shell 照样展开 `` ` `` 和 `$(…)`。这一半必须和
      // `extractSubstitutions` 说同一句话：谁都不能把「双引号里的命令替换」整个
      // 推给对方去认（LUM-758：推过去那一半漏了，这一半就成了唯一的门，却没人守）。
      if (unsafe === null && quote === '"') {
        if (c === '`') {
          unsafe = '`'
          unsafeInDoubleQuote = true
        } else if (c === '$' && !isLiteralDollar(segment, i)) {
          unsafe = '$'
          unsafeInDoubleQuote = true
        }
      }
      cur += c
      continue
    }
    // LUM-787 — `2>/dev/null` / `2>&1` as a whole unquoted token: consumed
    // here, never pushed as an argument. Anywhere else `>` and `&` stay
    // outside the safe set below.
    if (!started) {
      const redirect = STDERR_REDIRECT_TOKENS.find(
        t =>
          segment.startsWith(t, i) &&
          (i + t.length === segment.length || /\s/.test(segment[i + t.length]!))
      )
      if (redirect) {
        i += redirect.length - 1
        continue
      }
    }
    if (c === '"' || c === "'") {
      quote = c
      started = true
      continue
    }
    if (c === '\\' && i + 1 < segment.length) {
      // `\` + 换行：分段器把它当续行吞掉（shell 在**普通上下文**里也是这么算的），
      // 可一旦这个续行落在注释里，shell 根本不认，换行就成了硬分隔符。闸门没有
      // 「行」的概念，判不了它落在哪儿，所以直接判不安全——真实检索里没人需要在
      // 一条命令中间续行。(a) 的 `#` 规则已经独立堵死了这一族，这条是第二把锁。
      if (unsafe === null && segment[i + 1] === '\n') unsafe = '\\'
      cur += segment[++i]!
      started = true
      continue
    }
    if (/\s/.test(c)) {
      flush()
      continue
    }
    // 词首的 `#` 只能是注释：shell 从这里一路丢到行尾，闸门却会继续往下读，于是
    // 两边的引号 / 续行状态在换行处分叉，**换行之后的东西一条都没被审过就执行**
    // （`cat x #\<换行>curl …` 用注释废掉续行，`cat x #"<换行>curl … #"` 用注释
    // 吃掉一个引号，闸门以为换行在引号里）。词中的 `#` 不受影响，引号内和反斜杠
    // 转义的 `#`（`rg -n "#"`、`rg -n '#\[derive'`、`rg -n \#foo`）根本走不到这里。
    if (c === '#' && !started && unsafe === null) unsafe = '#'
    if (GLOB_CHARS.has(c)) {
      if (glob === null) glob = c
    } else if (unsafe === null && !SAFE_UNQUOTED_CHAR.test(c)) {
      unsafe = c
    }
    cur += c
    started = true
  }
  flush()
  return {
    tokens,
    glob,
    unsafe,
    unsafeInDoubleQuote,
    unbalancedQuote: quote !== null,
  }
}

/**
 * 从 `$(` 之后一路扫到配对的 `)`，返回闭合括号**之后**的下标（没闭合就是串尾）。
 * 引号感知：`$( … )` 内部是全新的引号上下文，单引号里的 `)` 不计入配对。
 */
function substitutionEnd(text: string, from: number): number {
  let depth = 1
  let j = from
  let inDouble = false
  while (j < text.length && depth > 0) {
    const c = text[j]!
    if (c === '\\' && j + 1 < text.length) {
      j += 2
      continue
    }
    if (c === '"') {
      inDouble = !inDouble
      j++
      continue
    }
    if (c === "'" && !inDouble) {
      const close = text.indexOf("'", j + 1)
      j = close === -1 ? text.length : close + 1
      continue
    }
    if (!inDouble && c === '(') depth++
    else if (!inDouble && c === ')') depth--
    j++
  }
  return j
}

/**
 * 抽取段内所有命令替换的内容（`$(...)` 和 `` `...` ``，含嵌套）。
 *
 * **双引号感知**是这里的要害：单引号只有在**引号外**才开始一段字面量，
 * `"it's $(curl …)"` 里的撇号按 shell 语义只是个普通字符。以前这里见 `'` 就跳到
 * 下一个 `'`（配不上就跳到串尾），于是双引号里一个落单的撇号就把后面整段吞掉，
 * `$(…)` 再也抽不出来——而 `scanSegment` 又把「双引号里的 `$(`」全权委托给了
 * 这个函数，两边同时漏，`cat "it's $(curl …)"` 就这么直接放行了（同形的
 * `` cat "it's `curl …`" `` 反而被拒，那个不对称就是这条 bug 的告示牌）。
 */
function extractSubstitutions(text: string): string[] {
  const out: string[] = []
  const push = (inner: string) => {
    out.push(inner)
    out.push(...extractSubstitutions(inner))
  }
  let i = 0
  let inDouble = false
  while (i < text.length) {
    const c = text[i]!
    if (c === '\\' && i + 1 < text.length) {
      i += 2
      continue
    }
    if (c === '"') {
      inDouble = !inDouble
      i++
      continue
    }
    if (c === "'" && !inDouble) {
      const close = text.indexOf("'", i + 1)
      i = close === -1 ? text.length : close + 1
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
      const j = substitutionEnd(text, i + 2)
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

/**
 * LUM-787 follow-up — `find` flags that execute, delete or write. Named here
 * even though `isReadOnlySegment` already refuses the executing ones: the
 * two layers must each recognise the construct on their own (the lesson at
 * the top of this file), and this list also covers the file-WRITING
 * actions (`-fprint`, `-fprintf`, `-fls`, `-fprint0`) that a "read-only"
 * classifier does not think of as mutation.
 */
const FIND_DENIED_FLAGS = new Set([
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-delete',
  '-fprint',
  '-fprint0',
  '-fprintf',
  '-fls',
])

function findGate(args: readonly string[]): string | null {
  for (const arg of args) {
    if (FIND_DENIED_FLAGS.has(arg)) {
      return `find action '${arg}' executes, deletes or writes; not allowed (find may only list and test)`
    }
  }
  return null
}

/**
 * LUM-758 — 选项闸门必须比对工具真正接受的**拼写族**，而不是一个字面量。
 * 这两个 helper 是 PR 1015 两个 HIGH 的共同病因修复。镜像里实测
 * (vercel/sandbox/universal: uutils coreutils 0.8.0, git):
 *
 *   sort --comp=/tmp/x  -> 执行 /tmp/x     (--compress-program 的前缀缩写)
 *   sort --o=/tmp/x     -> 写出文件        (--output 的前缀缩写)
 *   git grep -O/bin/echo -> 执行 /bin/echo (短选项附着取值)
 *
 * 前两个走 getopt 风格的**前缀缩写**：任何是被拒名字前缀的写法都被同一个
 * 解析器接受。第三个走**附着取值**：`-Oxxx` 与 `-O xxx` 等价。按字面量比对
 * 的闸门，离一个洞永远只差一种拼法。
 *
 * 反过来的方向是安全的：`--output-delimiter` 不是 `--output` 的缩写(它更长)，
 * 所以不会被误拒。
 */
function deniedLongPrefix(
  arg: string,
  denied: readonly string[]
): string | null {
  if (!arg.startsWith('--')) return null
  const name = arg.slice(2).split('=')[0]!
  if (name.length === 0) return null
  return (
    denied.find(d => d.startsWith('--') && d.slice(2).startsWith(name)) ?? null
  )
}

/** `-O/bin/sh` / `-Ovi` 都是 `-O` 带了附着值。 */
function deniedShortAttached(
  arg: string,
  denied: readonly string[]
): string | null {
  if (arg.startsWith('--') || !arg.startsWith('-') || arg.length < 2)
    return null
  const name = arg.slice(0, 2)
  return denied.includes(name) ? name : null
}

/**
 * `sort -o FILE` / `--output=FILE` 写文件；`--compress-program=PROG` 直接
 * **执行 PROG**（排序落临时文件时调用它压缩），是这张白名单上最短的一条
 * 任意执行路径。两者都按前缀缩写比对——见 `deniedLongPrefix`。
 */
const SORT_DENIED_LONG = ['--output', '--compress-program'] as const
const SORT_LONG_REASON: Record<string, string> = {
  '--output': 'writes a file',
  '--compress-program': 'runs a program',
}

function sortGate(args: readonly string[]): string | null {
  for (const arg of args) {
    // `-o FILE`, `-oFILE`, and `-o` folded into a short-flag cluster (`-ro`).
    if (!arg.startsWith('--') && /^-[a-zA-Z]*o/.test(arg)) {
      return "sort flag '-o' writes a file; not allowed"
    }
    const long = deniedLongPrefix(arg, SORT_DENIED_LONG)
    if (long) {
      return `sort flag '${long}' ${SORT_LONG_REASON[long]}; not allowed (written as '${arg.split('=')[0]}')`
    }
  }
  return null
}

/**
 * LUM-787 follow-up — git, read-only subset. The checkout is a depth-1 clone
 * at the head sha (`createRepoSandbox`), so history-walking is one commit
 * deep; what is worth allowing is the file-level view. Two things are
 * refused by name: global options that make git RUN something or read
 * another repository (`-c` can set `core.pager` / `diff.external`,
 * `--exec-path` points git at other binaries, `-p`/`--paginate` forces the
 * pager, `--git-dir`/`--work-tree`/`-C` leave the checkout), and the
 * subcommand options that write or run (`--output`, `--ext-diff`,
 * `--textconv`, `--open-files-in-pager`). `isReadOnlySegment` refuses the
 * writing subcommands independently.
 */
const GIT_HUNT_SUBCOMMANDS = new Set([
  'log',
  'show',
  'blame',
  'diff',
  'ls-files',
  'ls-tree',
  'rev-parse',
  'rev-list',
  'cat-file',
  'grep',
  'status',
  'shortlog',
  'name-rev',
  'describe',
])
const GIT_DENIED_GLOBAL = new Set([
  '-c',
  '-C',
  '-p',
  '--paginate',
  '--config-env',
  '--exec-path',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
])
const GIT_DENIED_OPTIONS = new Set([
  '--output',
  '--ext-diff',
  '--textconv',
  '--open-files-in-pager',
  '-O',
])

function gitGate(args: readonly string[]): string | null {
  const globals = [...GIT_DENIED_GLOBAL]
  const options = [...GIT_DENIED_OPTIONS]
  let i = 0
  // Global options come before the subcommand. git itself refuses an attached
  // global (`-cfoo=bar` -> "unknown option", verified in the image), so this
  // loop is not the hole PR 1015 was flagged for — but it costs nothing to
  // recognise the spelling here too, and it keeps both loops on one rule.
  for (; i < args.length && args[i]!.startsWith('-'); i++) {
    const arg = args[i]!
    const name =
      (GIT_DENIED_GLOBAL.has(arg.split('=')[0]!) ? arg.split('=')[0]! : null) ??
      deniedShortAttached(arg, globals)
    if (name) {
      return `git option '${name}' runs a program or leaves the checkout; not allowed`
    }
  }
  const sub = args[i]
  if (sub === undefined) return 'git needs a subcommand'
  if (!GIT_HUNT_SUBCOMMANDS.has(sub)) {
    return `git subcommand '${sub}' is not allowed; read-only: ${[...GIT_HUNT_SUBCOMMANDS].join(', ')}`
  }
  // The real PR 1015 hole: subcommand options go through git's parse-options,
  // which takes a short option's value ATTACHED. `git grep -O/bin/echo` ran
  // /bin/echo in the image while the gate saw the whole `-O/bin/echo` as an
  // unknown name and waved it through.
  for (const arg of args.slice(i + 1)) {
    const exact = arg.startsWith('--') ? arg.split('=')[0]! : arg
    const name =
      (GIT_DENIED_OPTIONS.has(exact) ? exact : null) ??
      deniedShortAttached(arg, options)
    if (name) {
      return `git option '${name}' writes a file or runs a program; not allowed`
    }
  }
  return null
}

/**
 * LUM-787 follow-up — awk, read-only subset. The script is inspected as
 * text: `system(…)` runs a program, `getline` can read from a command,
 * `|` pipes to one, `>` / `>>` write a file, and gawk's `@load` /
 * `@include` load code. `-f`/`--file` (a script the gate cannot read),
 * `-e`/`--source`/`--exec` (more script text) and `-l`/`--load` /
 * `-i`/`--include` (extensions) are refused by name. A comparison written
 * as `$1 > 5` is refused too — a false positive the reason names; write it
 * as a filter with `grep` or `rg` instead.
 */
const AWK_DENIED_FLAGS = new Set([
  '-f',
  '--file',
  '-e',
  '--source',
  '--exec',
  '-E',
  '-l',
  '--load',
  '-i',
  '--include',
])
const AWK_SCRIPT_DENIED = /system\s*\(|getline|\||>|@load|@include/

function awkGate(args: readonly string[]): string | null {
  let script: string | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (script === undefined && arg.startsWith('-') && arg !== '-') {
      const name = arg.startsWith('--') ? arg.split('=')[0]! : arg.slice(0, 2)
      if (AWK_DENIED_FLAGS.has(name)) {
        return `awk option '${name}' loads a script or extension the gate cannot inspect; not allowed`
      }
      // `-F x` / `-v x=y` take a value when written separately.
      if ((arg === '-F' || arg === '-v') && i + 1 < args.length) i++
      continue
    }
    if (script === undefined) script = arg
  }
  if (script === undefined) return 'awk needs a script'
  const hit = AWK_SCRIPT_DENIED.exec(script)
  if (hit) {
    return `awk script uses '${hit[0]}', which runs a program or writes (a '>' comparison counts too — filter with grep/rg instead); not allowed: ${script.slice(0, 60)}`
  }
  return null
}

/** 允许的动词里，哪些旗标会把「只读检索」变成写/执行。 */
const FLAG_GATES: Record<string, (args: readonly string[]) => string | null> = {
  sed: sedGate,
  rg: rgGate,
  find: findGate,
  sort: sortGate,
  git: gitGate,
  awk: awkGate,
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
    // 常见的「误报」其实是搜字面量：`rg "$(" lib/` 的 `(` 在闸门眼里是没闭合的
    // 引号。单引号整个包起来（`rg '$(' lib/`）就是出口，理由里直接写出来，省得
    // 模型拿转义反复试。
    return {
      ok: false,
      reason: `segment has an unbalanced quote; to search for a literal quote or metacharacter, wrap the whole pattern in single quotes (rg '$(' lib/): ${echo}`,
    }
  }
  if (scan.unsafe !== null) {
    // 双引号内的 `` ` ``/`$` 挡不住 shell 展开，但它们确确实实在引号**里**——
    // 说「outside quotes」是反话，第三轮复盘留下的这句理由曾经原样命中
    // `rg -n "cost: $5" lib/`、`` rg -n "`ls`" lib/ `` 这类拒绝，指着模型去做
    // 它已经做过的事（把 `$`/`` ` `` 包进了引号）。这里按 `unsafeInDoubleQuote`
    // 分岔，双引号分支点名两个真出口：换单引号（shell 完全不展开单引号内容），
    // 或者反斜杠转义那个字符（双引号内 `\$`/`` \` `` 都是字面量，`scanSegment`
    // 的转义分支已经放行）。
    const reason = scan.unsafeInDoubleQuote
      ? `segment uses the shell metacharacter '${scan.unsafe}' inside a double-quoted string, and the shell still expands it there; switch to single quotes, which shell never expands (rg -n '...' lib/), or backslash-escape it inside the double quotes (rg -n "\\${scan.unsafe}..." lib/): ${echo}`
      : `segment uses the shell metacharacter '${scan.unsafe}' outside quotes; quote it or drop it: ${echo}`
    return { ok: false, reason }
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
  // LUM-787 — an unquoted glob is admitted only where an expanded file name
  // cannot become an executing or writing flag (see GLOB_SAFE_COMMANDS).
  if (scan.glob !== null && !GLOB_SAFE_COMMANDS.has(name)) {
    return {
      ok: false,
      reason: `unquoted wildcard '${scan.glob}' is allowed only for ${[...GLOB_SAFE_COMMANDS].join(', ')} — for '${name}' an expanded file name could become a flag; quote the pattern (rg -g "*.ts", find . -name "*.ts") or name the files: ${echo}`,
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
 * `bash -c '…'` 包装的**严格**形状：`<壳名> <-c 旗标> <一个引号字面量>`，而且闭合
 * 引号之后**不能再有任何字符**。形状对得上就返回内层脚本，对不上返回 null。
 *
 * 为什么非得这么严：`unwrapShellWrapper` 走 `leadingQuotedLiteral`，只取**第一段**
 * 引号；而 `topLevelSegments` 又拿展开结果**替换掉**了原段。于是真正会执行的那半
 * 截可以整个消失：
 *   - `bash -c "cat x" & curl …`：闭合引号后的尾巴被丢掉，连字符白名单都没看过它；
 *   - `bash -c "cat "'x; curl …'`：shell 把相邻引号拼成同一个 `-c` 实参，闸门只读到
 *     `cat x`，拼上去的后半段照样执行。
 * 只「顺带把尾巴也检查一遍」堵得住前者、堵不住后者——后者的尾巴本身是合规的引号
 * 字面量，字符白名单挑不出毛病。所以判据是**尾巴非空即不是这个形状**：这样的段退
 * 回普通段去走字符白名单 + 命令名白名单（`bash` 从来不在白名单里，必被拒）。
 *
 * `$'…'` 的 ANSI-C 形式同样返回 null：`$'cat x\x3bcurl …'` 里的 `\x3b` 是 shell 解码
 * 出来的 `;`，这里不解码也不猜，退回普通段由引号外的 `$` 拒掉。
 */
function strictWrapperInner(segment: string): string | null {
  const head = /^(?:bash|sh|zsh|dash)[ \t]+(-[A-Za-z]+)[ \t]+/.exec(segment)
  if (head === null || !/^-[a-z]*c[a-z]*$/.test(head[1]!)) return null
  const rest = segment.slice(head[0].length)
  const quote = rest[0]
  if (quote !== '"' && quote !== "'") return null
  let body = ''
  let i = 1
  for (; i < rest.length; i++) {
    const c = rest[i]!
    if (c === '\\' && quote === '"' && i + 1 < rest.length) {
      body += rest[++i]!
      continue
    }
    if (c === quote) break
    body += c
  }
  // 引号没闭合（i 走到头），或闭合引号不是这一段的最后一个字符（有尾巴 / 相邻引号
  // 拼接）——两种都不是「一个引号字面量」，不展开。
  if (i !== rest.length - 1) return null
  return body
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
    // `unwrapShellWrapper` 负责认「这是不是个壳包装」（分词仍然委托 LUM-751），
    // `strictWrapperInner` 负责认「形状是不是严格到可以整段替换」。形状不严格就
    // **不替换**：原段留下来走普通段的字符白名单 + 命令名白名单。
    const inner =
      depth < MAX_WRAPPER_DEPTH && unwrapShellWrapper(seg) !== null
        ? strictWrapperInner(seg)
        : null
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
