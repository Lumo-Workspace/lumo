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

  return run.commitSha === current
    ? { state: 'fresh', currentSha: current }
    : { state: 'stale', currentSha: current }
}
