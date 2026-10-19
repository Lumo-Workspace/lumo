import { EXIT_USAGE } from '../lib/exit-codes'
import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { apiContext, apiCall } from '../lib/test-case-api'
import { resolveSessionId } from '../lib/session-id'
import { printStatusDigest } from '../lib/status-digest'
import { sanitizeField } from '../lib/sanitize'
import type { TestCaseScope } from '../lib/test-case-scope'
import {
  resolveRunLocator,
  readGitCoordinate,
  resolveCommitCoordinate,
  evidenceHint,
} from '../lib/test-case-handle'
import {
  resolveFailureCause,
  resolveUnprovenIndices,
  formatRunOutcome,
  type RunCeiling,
} from '../lib/test-case-verdict'
import {
  parseStepSpecs,
  parseStepEvidence,
  missingStepRefsLocal,
  formatMissingStepsError,
  isUrl,
} from '../lib/test-case-steps'

export interface TestCaseRunOptions {
  result?: string
  env?: string
  pr?: string
  commit?: string
  failedStep?: string
  failedVerify?: string
  cause?: string
  unproven?: string[]
  note?: string
  evidence?: string[]
  evidenceFile?: string[]
  /** LUM-1011: 逐步结果，如 s1-3=pass、v1=fail@0.3s（可重复）。 */
  step?: string[]
  /** LUM-1011: 挂到某一步下面的证据，如 s3=shot.png（可重复）。 */
  stepEvidence?: string[]
  /** LUM-1011: FAIL 时实际看到的结果。 */
  actual?: string
}

const RESULTS = ['PASS', 'FAIL', 'BLOCKED']
const ENVIRONMENTS = ['LOCAL', 'PREVIEW', 'PRODUCTION']
const MAX_EVIDENCE_FILES = 5

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.json': 'application/json',
}

interface RunResponse {
  run: {
    result: string
    environment: string
    failedStepText: string | null
  }
  /** LUM-808: 服务端推导的封顶结论。CLI 只渲染，不重算。 */
  ceiling: RunCeiling
}

interface UploadResponse {
  files: Array<{
    url: string
    filename: string
    contentType: string
    size: number
  }>
}

export async function testCaseRunInScope(
  scope: TestCaseScope,
  caseRef: string,
  options: TestCaseRunOptions
): Promise<number | void> {
  const handle = `${scope.label}/${caseRef}`
  // LUM-1135: a milestone spans many PRs — the commit is the coordinate.
  if (scope.kind === 'milestone' && options.pr !== undefined) {
    console.error(
      'Error: --pr does not apply to a milestone run (a milestone spans many PRs); the commit is recorded instead.'
    )
    return EXIT_USAGE
  }

  const result = options.result?.trim().toUpperCase()
  if (!result || !RESULTS.includes(result)) {
    console.error(
      `Error: --result is required. Valid values: ${RESULTS.join(' | ').toLowerCase()}.`
    )
    return EXIT_USAGE
  }

  // environment 没有默认值 —— 这个命令存在的理由就是分清跑在哪个环境。
  // 不要在这里加 `?? 'LOCAL'`。
  const env = options.env?.trim().toUpperCase()
  if (!env || !ENVIRONMENTS.includes(env)) {
    console.error(
      `Error: --env is required (no default). Valid values: ${ENVIRONMENTS.join(' | ').toLowerCase()}.`
    )
    return EXIT_USAGE
  }

  const locator = resolveRunLocator(options)
  if (!locator.ok) {
    console.error(`Error: ${locator.error}`)
    return EXIT_USAGE
  }
  if (result !== 'FAIL' && locator.failedPhase !== null) {
    console.error(
      `Error: a ${result} run cannot carry a failure locator. BLOCKED means the case never ran; use --result fail to point at a step.`
    )
    return EXIT_USAGE
  }

  // LUM-1011: 逐步结果。只有 FAIL 能带 fail 步；BLOCKED 根本没跑起来。
  const steps = parseStepSpecs(options.step)
  if (!steps.ok) {
    console.error(`Error: ${steps.error}`)
    return EXIT_USAGE
  }
  const stepEvidence = parseStepEvidence(options.stepEvidence)
  if (!stepEvidence.ok) {
    console.error(`Error: ${stepEvidence.error}`)
    return EXIT_USAGE
  }
  if (result === 'BLOCKED' && steps.value.length > 0) {
    console.error(
      'Error: a BLOCKED run cannot carry --step results — the case never ran. Use --result fail with the failing step instead.'
    )
    return EXIT_USAGE
  }
  if (result !== 'FAIL' && steps.value.some(s => s.status === 'FAIL')) {
    console.error(`Error: a ${result} run cannot report a failing --step.`)
    return EXIT_USAGE
  }
  for (const e of stepEvidence.value) {
    if (!steps.value.some(s => s.phase === e.phase && s.index === e.index)) {
      const ref = `${e.phase === 'STEPS' ? 's' : 'v'}${e.index + 1}`
      console.error(
        `Error: --step-evidence ${ref} needs a matching --step ${ref}=pass|fail|skip:<reason>.`
      )
      return EXIT_USAGE
    }
  }
  const actual = options.actual?.trim() || null
  if (actual !== null && result !== 'FAIL') {
    console.error(
      `Error: --actual is for a failing run (got --result ${result.toLowerCase()}).`
    )
    return EXIT_USAGE
  }

  // LUM-808 步骤 1：FAIL 必须说清是谁的锅。服务端有同样的闸门，这里挡一道
  // 只是为了不让人白跑一趟网络。
  const cause = resolveFailureCause(
    options.cause,
    result as 'PASS' | 'FAIL' | 'BLOCKED'
  )
  if (!cause.ok) {
    console.error(`Error: ${cause.error}`)
    return EXIT_USAGE
  }

  // LUM-808 步骤 2：本次没能观察到的复验条目（1-based → 0-based）。
  const unproven = resolveUnprovenIndices(options.unproven)
  if (!unproven.ok) {
    console.error(`Error: ${unproven.error}`)
    return EXIT_USAGE
  }

  let prNumber: number | null = null
  if (options.pr !== undefined) {
    const raw = options.pr.trim().replace(/^#/, '')
    if (!/^\d+$/.test(raw) || Number(raw) < 1) {
      console.error(
        `Error: invalid --pr "${options.pr}". Expected a PR number, e.g. --pr 123.`
      )
      return EXIT_USAGE
    }
    prNumber = Number(raw)
  }

  // 代码坐标。只有 --env local 会从本地 git 推断——见 resolveCommitCoordinate
  // 的注释：本地检出跑的不是 production / preview 跑的东西。
  const coord = resolveCommitCoordinate({
    env,
    commit: options.commit,
    readGit: () =>
      readGitCoordinate((cmd, args) =>
        spawnSync(cmd, args, { encoding: 'utf8' })
      ),
  })
  const { commitSha, commitDirty } = coord

  const ctx = apiContext()
  if (!ctx) return 1
  const base = `${scope.basePath}/test-cases/${encodeURIComponent(caseRef)}`

  const evidence: Array<Record<string, unknown>> = (options.evidence ?? []).map(
    url => ({ type: 'link', url: url.trim() })
  )

  // LUM-1011: 挂到某一步的证据跟普通证据进同一个数组，逐步结果里记下标。
  // URL 直接成 link；文件跟 --evidence-file 一起上传，上传回来后按顺序认领。
  const stepEvidenceIdx = new Map<string, number[]>()
  const claim = (phase: string, index: number, at: number) => {
    const key = `${phase}:${index}`
    stepEvidenceIdx.set(key, [...(stepEvidenceIdx.get(key) ?? []), at])
  }
  const stepFiles: Array<{ phase: string; index: number; path: string }> = []
  for (const e of stepEvidence.value) {
    if (isUrl(e.target)) {
      claim(e.phase, e.index, evidence.length)
      evidence.push({ type: 'link', url: e.target })
    } else {
      stepFiles.push({ phase: e.phase, index: e.index, path: e.target })
    }
  }

  const paths = [...(options.evidenceFile ?? []), ...stepFiles.map(f => f.path)]
  if (paths.length > MAX_EVIDENCE_FILES) {
    console.error(
      `Error: at most ${MAX_EVIDENCE_FILES} evidence files per run, --evidence-file and --step-evidence together (got ${paths.length}).`
    )
    return 1
  }
  if (paths.length > 0) {
    // LUM-1211: 服务端会因漏报逐步结果拒绝这条 run；先在本地预检，别为一条
    // 必拒的 run 上传出孤儿证据。没有文件要传时不多发这一次请求。
    const pre = await apiCall<{
      testCase: { steps: string[]; verification: string[] }
    }>(ctx, base, {}, 'test case show')
    if (!pre.ok || !pre.data) return 1
    const missing = missingStepRefsLocal(pre.data.testCase, {
      result: result as 'PASS' | 'FAIL' | 'BLOCKED',
      steps: steps.value,
      failLocator:
        locator.failedPhase !== null && locator.failedIndex !== null
          ? { phase: locator.failedPhase, index: locator.failedIndex }
          : null,
      unprovenVerification: unproven.indices,
    })
    if (missing.length > 0) {
      console.error(`Error: ${formatMissingStepsError(missing)}`)
      return 1
    }

    const fd = new FormData()
    for (const p of paths) {
      let bytes: Buffer
      try {
        statSync(p)
        bytes = readFileSync(p)
      } catch {
        console.error(`Error: cannot read evidence file "${p}".`)
        return 1
      }
      const type = MIME_BY_EXT[extname(p).toLowerCase()] ?? 'text/plain'
      fd.append(
        'file',
        new Blob([new Uint8Array(bytes)], { type }),
        basename(p)
      )
    }

    const up = await apiCall<UploadResponse>(
      ctx,
      `${base}/evidence`,
      { method: 'POST', body: fd },
      'evidence upload'
    )
    if (!up.ok || !up.data) return 1
    const plainFiles = (options.evidenceFile ?? []).length
    up.data.files.forEach((f, i) => {
      const owner = i >= plainFiles ? stepFiles[i - plainFiles] : undefined
      if (owner) claim(owner.phase, owner.index, evidence.length)
      evidence.push({ type: 'file', ...f })
    })
  }

  const stepResults = steps.value.map(s => ({
    phase: s.phase,
    index: s.index,
    status: s.status,
    ...(s.status === 'SKIP' ? { reason: s.reason } : {}),
    durationMs: s.durationMs,
    evidence: stepEvidenceIdx.get(`${s.phase}:${s.index}`) ?? [],
  }))

  // LUM-1008: 带上来源 session——run 记下的成员是 token 主人，「人手动」还是
  // 「agent 代跑」只能靠它分。不在 Claude Code 里跑时为空，照常不带。
  const headers: Record<string, string> = {}
  const sessionId = await resolveSessionId({ write: true })
  if (sessionId) headers['X-Lumo-Session-Id'] = sessionId

  const r = await apiCall<RunResponse>(
    ctx,
    `${base}/runs`,
    {
      method: 'POST',
      headers,
      json: {
        result,
        environment: env,
        failedPhase: locator.failedPhase,
        failedIndex: locator.failedIndex,
        failureAttribution: cause.cause,
        unprovenVerification: unproven.indices,
        note: options.note?.trim() || null,
        // LUM-1211: 服务端要求每一步都上报；缺了它会 400 并列出缺项，CLI 原样转述。
        ...(stepResults.length > 0 ? { stepResults } : {}),
        ...(actual !== null ? { actual } : {}),
        pullRequestNumber: prNumber,
        commitSha,
        commitDirty,
        evidence,
      },
    },
    'run record'
  )
  if (!r.ok || !r.data) return 1

  // LUM-808: 被封顶时这一行自己就说清「我报的是什么 / 实际结论是什么 /
  // 因为哪条边界」——自己报的 PASS 当场降级，比事后在网页上发现有用得多。
  console.log(
    formatRunOutcome({
      handle,
      reported: r.data.run.result,
      environment: r.data.run.environment,
      ceiling: r.data.ceiling ?? { effective: r.data.run.result as 'PASS' },
    })
  )
  if (r.data.run.failedStepText) {
    console.log(`  at: ${sanitizeField(r.data.run.failedStepText)}`)
  }
  if (actual !== null) console.log(`  actual: ${actual}`)
  if (stepResults.length > 0) {
    const n = (st: string) => stepResults.filter(r => r.status === st).length
    const parts = [`${n('PASS')} passed`]
    if (n('SKIP') > 0) parts.push(`${n('SKIP')} skipped`)
    if (n('FAIL') > 0) parts.push(`${n('FAIL')} failed`)
    console.log(`Steps: ${parts.join(', ')} of ${stepResults.length} reported`)
  }
  if (prNumber !== null) console.log(`PR: #${prNumber}`)
  if (commitSha) {
    const dirty = commitDirty === true ? ' (uncommitted changes present)' : ''
    console.log(`Commit: ${commitSha.slice(0, 7)}${dirty}`)
  } else if (coord.hint) {
    console.log(coord.hint)
  }
  if (evidence.length > 0) console.log(`Evidence: ${evidence.length} item(s)`)
  // LUM-807 follow-up: ask for the output while it is still on screen. The
  // gate lives in `evidenceHint` (null once evidence rode along), so this
  // call site cannot drift away from it.
  const hint = evidenceHint({ evidenceCount: evidence.length, result })
  if (hint) console.log(hint)
  // LUM-842: a run can add or clear a DONE-blocking defect — show the task's
  // state now instead of leaving it to a follow-up `lumo task status`.
  if (scope.kind === 'task') {
    await printStatusDigest(ctx.base, ctx.token, scope.label)
  }
}
