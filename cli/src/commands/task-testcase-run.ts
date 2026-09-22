import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { apiContext, apiCall } from '../lib/test-case-api'
import {
  splitCaseHandle,
  resolveRunLocator,
  readGitCoordinate,
  resolveCommitCoordinate,
  evidenceHint,
} from '../lib/test-case-handle'

export interface TestCaseRunOptions {
  result?: string
  env?: string
  pr?: string
  commit?: string
  failedStep?: string
  failedVerify?: string
  note?: string
  evidence?: string[]
  evidenceFile?: string[]
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
}

interface UploadResponse {
  files: Array<{
    url: string
    filename: string
    contentType: string
    size: number
  }>
}

export async function taskTestCaseRun(
  handle: string | undefined,
  options: TestCaseRunOptions
): Promise<number | void> {
  if (!handle) {
    console.error(
      'Error: missing <task/case>. Usage: lumo task testcase run LUM-42/TC3 --result pass --env local'
    )
    return 1
  }
  const split = splitCaseHandle(handle)
  if (!split) {
    console.error(
      `Error: invalid handle "${handle}". Expected <task>/TC<n>, e.g. LUM-42/TC3.`
    )
    return 1
  }

  const result = options.result?.trim().toUpperCase()
  if (!result || !RESULTS.includes(result)) {
    console.error(
      `Error: --result is required. Valid values: ${RESULTS.join(' | ').toLowerCase()}.`
    )
    return 1
  }

  // environment 没有默认值 —— 这个命令存在的理由就是分清跑在哪个环境。
  // 不要在这里加 `?? 'LOCAL'`。
  const env = options.env?.trim().toUpperCase()
  if (!env || !ENVIRONMENTS.includes(env)) {
    console.error(
      `Error: --env is required (no default). Valid values: ${ENVIRONMENTS.join(' | ').toLowerCase()}.`
    )
    return 1
  }

  const locator = resolveRunLocator(options)
  if (!locator.ok) {
    console.error(`Error: ${locator.error}`)
    return 1
  }
  if (result !== 'FAIL' && locator.failedPhase !== null) {
    console.error(
      `Error: a ${result} run cannot carry a failure locator. BLOCKED means the case never ran; use --result fail to point at a step.`
    )
    return 1
  }

  let prNumber: number | null = null
  if (options.pr !== undefined) {
    const raw = options.pr.trim().replace(/^#/, '')
    if (!/^\d+$/.test(raw) || Number(raw) < 1) {
      console.error(
        `Error: invalid --pr "${options.pr}". Expected a PR number, e.g. --pr 123.`
      )
      return 1
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
  const base = `/api/tasks/${encodeURIComponent(split.task)}/test-cases/${encodeURIComponent(split.caseRef)}`

  const evidence: Array<Record<string, unknown>> = (options.evidence ?? []).map(
    url => ({ type: 'link', url: url.trim() })
  )

  const paths = options.evidenceFile ?? []
  if (paths.length > MAX_EVIDENCE_FILES) {
    console.error(
      `Error: at most ${MAX_EVIDENCE_FILES} --evidence-file per run (got ${paths.length}).`
    )
    return 1
  }
  if (paths.length > 0) {
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
    for (const f of up.data.files) evidence.push({ type: 'file', ...f })
  }

  const r = await apiCall<RunResponse>(
    ctx,
    `${base}/runs`,
    {
      method: 'POST',
      json: {
        result,
        environment: env,
        failedPhase: locator.failedPhase,
        failedIndex: locator.failedIndex,
        note: options.note?.trim() || null,
        pullRequestNumber: prNumber,
        commitSha,
        commitDirty,
        evidence,
      },
    },
    'run record'
  )
  if (!r.ok || !r.data) return 1

  const where = r.data.run.failedStepText
    ? `  at: ${r.data.run.failedStepText}`
    : ''
  console.log(
    `Recorded ${handle}: ${r.data.run.result} on ${r.data.run.environment}${where}`
  )
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
}
