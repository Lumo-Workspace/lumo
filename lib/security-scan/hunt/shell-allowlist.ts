/**
 * LUM-758 §5.4 — 沙箱 agent 的命令闸门。**两层，顺序固定**：
 *
 *   1. 把命令拆成真正会执行的段：顶层用 `splitSegmentsQuoteAware` 按
 *      `;`/`&&`/`||`/`|`/换行切分（引号感知），`bash -c '…'` 之类的壳包装用
 *      `unwrapShellWrapper` 递归展开，藏在参数里的 `$(...)` 命令替换额外单独
 *      抽取出来再走一遍同样的流程——这三件事都复用 LUM-751 已有的纯函数，
 *      不重新发明分词器。
 *   2. 每一段先过 `isReadOnlySegment`，**再**过命令名白名单
 *      （`HUNT_SHELL_COMMANDS`）。
 *
 * 两层不能合并：`isReadOnlySegment` 只回答「是不是只读」，不回答「是不是
 * 我们允许的工具」—— `git log` / `git status` 是只读的，但 agent 不该拿到
 * 完整的 git。
 *
 * 注意：这里**没有**复用 `executingSegments`。那个函数对 boundary-crossing
 * 的用途是「过滤掉已确认只读的段，只留下需要人工/规则进一步审查的段」——
 * 它会把 `git status`（只读）整段丢弃，于是我们就再也看不到它，无法拿命令名
 * 去比对我们这张更窄的白名单。两处函数都要用，但用法不同：本文件把
 * `isReadOnlySegment` 当作逐段必须通过的第一关，而不是拿 `executingSegments`
 * 的输出再喂回 `isReadOnlySegment`（那样对全只读命令必然拿到空数组，会把
 * `rg`/`cat` 这类合法调用也拒绝掉）。
 *
 * `isReadOnlySegment` 按动词判定只读，不检查参数——`cat secrets > /tmp/out`
 * 的动词依然是 `cat`。所以这里另外做了一次「段内出现不在引号里的 `>`」检测，
 * 拦掉输出重定向；command-shape 的只读表没有这层概念，不属于它的职责范围。
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

function commandNameOf(segment: string): string {
  const first = segment.trim().split(/\s+/)[0] ?? ''
  // 去掉路径前缀（`/usr/bin/git` 和 `git` 是同一件事）以及可能残留的
  // 引号 / `$(` 前缀。
  const stripped = first.replace(/^["'$(]+/, '')
  return stripped.slice(stripped.lastIndexOf('/') + 1)
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

/** 段内是否存在不在引号里的 `>`（覆盖 `>` 和 `>>`，都以 `>` 开头）。 */
function hasUnquotedRedirect(segment: string): boolean {
  let quote: '"' | "'" | null = null
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!
    if (quote) {
      if (c === '\\' && quote === '"' && i + 1 < segment.length) {
        i++
      } else if (c === quote) {
        quote = null
      }
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (c === '\\' && i + 1 < segment.length) {
      i++
      continue
    }
    if (c === '>') return true
  }
  return false
}

/**
 * 抽取段内所有 `$(...)` 命令替换的内容（含嵌套），单引号内的内容按 shell
 * 语义不会被替换，直接跳过；双引号内仍会展开，正常扫描。
 */
function extractSubstitutions(text: string): string[] {
  const out: string[] = []
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
      const inner = text.slice(i + 2, Math.max(j - 1, i + 2))
      out.push(inner)
      out.push(...extractSubstitutions(inner))
      i = j
      continue
    }
    i++
  }
  return out
}

function checkSegment(segment: string, depth: number): HuntCommandCheck {
  if (hasUnquotedRedirect(segment)) {
    return {
      ok: false,
      reason: `segment redirects output, writes are not allowed: ${segment.slice(0, 120)}`,
    }
  }
  for (const substitution of extractSubstitutions(segment)) {
    const nested = checkCommandText(substitution, depth + 1)
    if (!nested.ok) return nested
  }
  if (!isReadOnlySegment(segment)) {
    return {
      ok: false,
      reason: `segment is not read-only: ${segment.slice(0, 120)}`,
    }
  }
  const name = commandNameOf(segment)
  if (!HUNT_SHELL_COMMANDS.includes(name)) {
    return {
      ok: false,
      reason: `command '${name}' is not allowed; allowed: ${ALLOWED_LIST}`,
    }
  }
  return { ok: true }
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
