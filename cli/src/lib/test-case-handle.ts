/**
 * LUM-801: test case CLI 的纯函数。
 *
 * 抽出来单独测的理由是这里藏着两处最容易错的换算：
 *   - `LUM-12/TC3` 这个复合句柄的切分（服务端不认识带斜杠的句柄）
 *   - CLI 表面 **1-based** ↔ 存储 **0-based** 的步骤编号换算
 */

/**
 * `LUM-12/TC3` → `{ task: 'LUM-12', caseRef: 'TC3' }`.
 *
 * 切分发生在 CLI 侧：服务端路由是 /api/tasks/[id]/test-cases/[caseRef]，
 * 不认识带斜杠的复合句柄（否则 URL 里还得再嵌一层编码）。
 */
export function splitCaseHandle(
  handle: string
): { task: string; caseRef: string } | null {
  const parts = handle.split('/')
  if (parts.length !== 2) return null
  const [task, caseRef] = parts
  if (!task || !caseRef) return null
  return { task, caseRef }
}

/**
 * CLI 表面是 **1-based**（和终端打印的步骤编号对齐）；存储是 **0-based**。
 * 转换只在这里发生。
 */
export function toZeroBased(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null
  const n = parseInt(raw, 10)
  if (n < 1) return null
  return n - 1
}

export type RunLocator =
  | {
      ok: true
      failedPhase: 'STEPS' | 'VERIFICATION' | null
      failedIndex: number | null
    }
  | { ok: false; error: string }

/** `--failed-step` / `--failed-verify` 互斥，1-based，转 0-based。 */
export function resolveRunLocator(options: {
  failedStep?: string | undefined
  failedVerify?: string | undefined
}): RunLocator {
  const { failedStep, failedVerify } = options
  if (failedStep !== undefined && failedVerify !== undefined) {
    return {
      ok: false,
      error: '--failed-step and --failed-verify are mutually exclusive.',
    }
  }
  if (failedStep === undefined && failedVerify === undefined) {
    return { ok: true, failedPhase: null, failedIndex: null }
  }
  const raw = (failedStep ?? failedVerify)!
  const index = toZeroBased(raw)
  if (index === null) {
    return {
      ok: false,
      error: `Invalid index "${raw}". Step numbers are 1-based (the first step is 1).`,
    }
  }
  return {
    ok: true,
    failedPhase: failedStep !== undefined ? 'STEPS' : 'VERIFICATION',
    failedIndex: index,
  }
}

export interface GitCoordinate {
  commitSha: string | null
  commitDirty: boolean | null
}

/**
 * 注入点，方便测试：真实实现传 spawnSync 的薄封装。
 *
 * 下面的块级豁免是因为 no-unused-vars 会把**函数类型**里的形参名当成未使用的
 * 变量报出来（`_` 前缀在本仓库的配置里也不豁免）——它们是类型签名的一部分，
 * 不是变量。
 */
/* eslint-disable no-unused-vars */
export type RunCommand = (
  cmd: string,
  args: string[]
) => { status: number | null; stdout: string }
/* eslint-enable no-unused-vars */

/**
 * 从 cwd 的 git 检出读被测代码的坐标。
 *
 * 不在 git 仓库里（或 git 不可用）→ 两个都 null。**不编造**：null 的意思是
 * 「没记录」，读端会据此落在 `unknown` 而不是谎称 fresh。
 *
 * `commitDirty` 很重要：带着未提交改动跑出来的绿，那个 HEAD sha 并不代表被测
 * 的代码。宁可标脏，也不要让它冒充一次干净的验证。
 */
export function readGitCoordinate(run: RunCommand): GitCoordinate {
  const head = run('git', ['rev-parse', 'HEAD'])
  if (head.status !== 0) return { commitSha: null, commitDirty: null }
  const sha = head.stdout.trim()
  if (!/^[0-9a-f]{7,40}$/i.test(sha))
    return { commitSha: null, commitDirty: null }

  const status = run('git', ['status', '--porcelain'])
  const dirty = status.status === 0 ? status.stdout.trim().length > 0 : null
  return { commitSha: sha, commitDirty: dirty }
}

export interface CommitCoordinate {
  commitSha: string | null
  commitDirty: boolean | null
  /** 非 null 时，命令应把它打给用户，解释为什么没记 commit。 */
  hint: string | null
}

/**
 * 决定一条 run 要不要记 commit 坐标，以及记什么。
 *
 * **只有 `--env local` 才允许从本地 git 推断。** 本地检出跑的不是
 * production / preview 跑的东西：把操作者的 HEAD 记成「生产验过的 commit」
 * 是假话，而且陈旧性判定可能因此把它标成 `fresh` —— 一个假的「已验证」，
 * 正是整个 fail-closed 设计要防的东西（LUM-801 走查时从截图里看出来的：
 * 一条 `--env production` 的 run 记着本地 #1038 分支的 HEAD）。
 *
 * 非 local 环境要记 commit，必须显式 `--commit <sha>` —— 由人断言「生产上
 * 跑的就是这个」，而不是让工具去猜。
 */
export function resolveCommitCoordinate(args: {
  env: string
  commit?: string | undefined
  readGit: () => GitCoordinate
}): CommitCoordinate {
  const explicit = args.commit?.trim()
  if (explicit) {
    // 显式指定时不再声称知道工作区脏不脏。
    return { commitSha: explicit, commitDirty: null, hint: null }
  }

  if (args.env !== 'LOCAL') {
    return {
      commitSha: null,
      commitDirty: null,
      hint:
        `Commit: not recorded — the local checkout is not what ${args.env.toLowerCase()} runs. ` +
        `Pass --commit <sha> to state which commit was exercised.`,
    }
  }

  const git = args.readGit()
  return {
    commitSha: git.commitSha,
    commitDirty: git.commitDirty,
    hint: git.commitSha ? null : 'Commit: not recorded (not a git checkout)',
  }
}
