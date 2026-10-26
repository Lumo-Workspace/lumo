/**
 * LUM-801: 一条 test case run 的「代码坐标」与陈旧性推导。
 *
 * **这个模块必须保持纯净——不得 import prisma、repository 或 service。**
 * 客户端组件（RunHistoryList / TestCaseCard / RecordRunDialog）要用
 * `deriveRunFreshness`，而它是运行时值不是类型；从 service 里 import 会把
 * 整个服务层连同 Prisma + pg 拖进浏览器 bundle（Vercel 构建会以
 * module-not-found 失败，`tsc` 和 jest 都查不出来）。也正因如此，它同时是
 * CLAUDE.md 分层的要求：Component 不 import Service。
 *
 * 函数签名刻意写成**结构化最小类型**而不是 Prisma 行类型，这样两边都不必
 * 把 @prisma/client 的类型牵进来。
 */

export interface TaskPullRequestSnapshot {
  id: string
  number: number
  title: string
  url: string
  state: string
  headSha: string | null
  mergeCommitSha: string | null
}

/** 一条 run 上与陈旧性有关的那三列。 */
export interface RunCoordinate {
  pullRequestId: string | null
  commitSha: string | null
  commitDirty: boolean | null
}

/**
 * 两个 commit sha 是否指同一个 commit。
 *
 * 按**较短那个的长度**取前缀比较，大小写不敏感。
 *
 * 为什么不能直接 `===`：run 的 `commitSha` 允许 7–40 位 hex（见
 * `lib/validation/test-case.ts`），CLI 的 `--commit` 也接受缩写——git 全生态
 * 都这么用，本仓库自己的文档示例写的就是 `--commit 80b62a3`。而 PR 存的
 * headSha / mergeCommitSha 是 40 位全长。精确相等会让**任何缩写 sha 永远判
 * stale**：LUM-801 走查时，同一个 commit 的 7 位写法和 40 位写法在同一条
 * 用例上被判成了两种结果。
 *
 * 前缀比较的碰撞风险按 7 位 hex 约 1/2.7 亿，且 git 本身就依赖这个约定。
 *
 * LUM-1310: 也被 issue assessment 用来挑「跑在 PR head 上」的 run。
 */
export function sameCommit(a: string, b: string): boolean {
  const n = Math.min(a.length, b.length)
  return a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase()
}

export type RunFreshness =
  | { state: 'fresh'; currentSha: string }
  | { state: 'stale'; currentSha: string }
  | { state: 'dirty'; currentSha: string | null }
  | { state: 'unknown'; currentSha: string | null }

/**
 * 这条 run 验的还是 PR 现在的代码吗？
 *
 * **Fail-closed**：缺任何一半（run 没记 sha、PR 的 head 还没同步到、run 压根没绑
 * PR）一律 `unknown`，**绝不**乐观地报 `fresh`。一个假的 `fresh` 比一个诚实的
 * `unknown` 危险得多——前者会让人以为验过了。
 *
 * `commitDirty` 优先于一切：跑的时候工作区是脏的，那个 sha 就不代表被测代码，
 * 哪怕它和 PR head 一模一样也不算 fresh。
 *
 * PR 已合并时比的是 `mergeCommitSha`：生产环境那次执行对应的是合并 commit，
 * 不是 PR 头。
 *
 * 纯函数，**不落列**：存一个 isStale，PR 一 push 它就开始撒谎。
 */
export function deriveRunFreshness(
  run: RunCoordinate,
  pr: TaskPullRequestSnapshot | null
): RunFreshness {
  const current =
    pr === null
      ? null
      : pr.state === 'merged'
        ? (pr.mergeCommitSha ?? pr.headSha)
        : pr.headSha

  if (run.commitDirty === true) return { state: 'dirty', currentSha: current }
  if (!run.pullRequestId || !run.commitSha || !current)
    return { state: 'unknown', currentSha: current }

  return sameCommit(run.commitSha, current)
    ? { state: 'fresh', currentSha: current }
    : { state: 'stale', currentSha: current }
}
