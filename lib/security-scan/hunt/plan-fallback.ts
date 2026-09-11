/**
 * LUM-758 — 规划步的确定性兜底（设计 §4.4）。规划模型失败 / 超时时，把
 * `evaluateHuntTrigger` 的 reasons 直接映射成类别。纯函数、无 I/O。
 *
 * 红线：**绝不退回跑满 6 类**。映射不出东西时返回空数组（= 这个 PR 不值得
 * hunt），这是 LUM-762 用 0 finding / 14 次 PARTIAL 换来的结论。
 *
 * `race` / `logic` 没有确定性的 diff 信号，因此兜底永远不会选中它们 ——
 * 只有规划模型能主动要求这两类。
 */
import {
  HUNT_MAX_PLANNED_CATEGORIES,
  type HuntCategory,
} from '@/lib/services/security-hunt.config'

/** sink 规则 id（`lib/security-scan/graph/patterns.ts`）→ 类别。 */
const SINK_TO_CATEGORY: Readonly<Record<string, HuntCategory>> = {
  'prisma-raw': 'injection',
  'child-process': 'injection',
  eval: 'injection',
  'new-function': 'injection',
  'fs-write': 'injection',
  fetch: 'ssrf',
  redirect: 'ssrf',
  'llm-call': 'prompt_injection',
}

/** 命中多于上限时的取舍顺序：可利用性与判定精度由高到低。 */
export const FALLBACK_PRIORITY: readonly HuntCategory[] = [
  'injection',
  'idor',
  'ssrf',
  'prompt_injection',
]

/** 抵消 idor 推断的控制规则 id：diff 自己加了鉴权就不是无控制入口。 */
const IDOR_SUPPRESSING_CONTROLS = ['auth', 'workspace-scope']

export function planFallback(reasons: string[]): HuntCategory[] {
  const hit = new Set<HuntCategory>()
  let hasEntry = false
  let hasSuppressingControl = false

  for (const reason of reasons) {
    if (reason.startsWith('diff:sink:')) {
      const category = SINK_TO_CATEGORY[reason.slice('diff:sink:'.length)]
      if (category) hit.add(category)
      continue
    }
    if (reason.startsWith('diff:entry:')) {
      hasEntry = true
      continue
    }
    if (reason.startsWith('diff:control:')) {
      const id = reason.slice('diff:control:'.length)
      if (IDOR_SUPPRESSING_CONTROLS.includes(id)) hasSuppressingControl = true
    }
  }
  if (hasEntry && !hasSuppressingControl) hit.add('idor')

  return FALLBACK_PRIORITY.filter(c => hit.has(c)).slice(
    0,
    HUNT_MAX_PLANNED_CATEGORIES
  )
}
