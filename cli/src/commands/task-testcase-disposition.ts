import { apiContext, apiCall } from '../lib/test-case-api'
import { printStatusDigest } from '../lib/status-digest'
import { splitCaseHandle } from '../lib/test-case-handle'
import { emitConfirmation } from '../lib/confirmation'
import { taskScope, type TestCaseScope } from '../lib/test-case-scope'
import {
  checkStep,
  describeDefectRead,
  describeDefectRuling,
  pickRuling,
  type DefectRuling,
  type DefectSubject,
  type DispositionFlags,
} from '../lib/test-case-disposition'

export interface TestCaseDispositionOptions extends DispositionFlags {
  note?: string
}

interface RunRow {
  id: string
  result: string
  failureAttribution: string | null
  evidence: unknown
  createdAt: string
  disposition: { disposition: string } | null
}

interface ShowResponse {
  testCase: { number: number; title: string }
  runs: RunRow[]
}

interface IssuedReceipt {
  receipt: string
  expiresAt: string
  readAt: string
  readAcknowledgedAt: string | null
}

/**
 * `lumo task testcase disposition <task/case> --known-defect | --not-a-defect
 * [--note <text>] [--receipt <token>] [--confirm-read | --confirm]` — LUM-812.
 *
 * 对一条「证明了坏」的 run 落人类裁定,清掉它对 DONE 的拦截。**三步握手**,与
 * `lumo crossing disposition` 同一套协议、同一份服务端实现:
 *
 *   1. 不带步骤 flag:读那条 run、取 stage-1 回执、打 exit-4 信封。什么都不写。
 *      转述给用户,**等他说读过了**;信封的 confirmCommand 以 `--confirm-read` 结尾;
 *   2. `--confirm-read --receipt <r1>`:换 stage-2 回执,打第二个信封(裁定本身)。
 *      仍然什么都不写。转述,**等他批准裁定**;
 *   3. `--confirm --receipt <r2>`:落库。
 *
 * **`--confirm-read` / `--confirm` 永远不要自己加**——每一个都代表用户对那一步的
 * 批准。服务端无法核实聊天里的批准,所以裁定被记为 `channel: 'CLI'`。
 *
 * 裁的永远是该用例**最新那条** run:闸门只看最新一条,对旧 run 下裁定清不掉任何
 * 东西,服务端会以 409 拒绝。
 */
export async function taskTestCaseDisposition(
  handle: string | undefined,
  options: TestCaseDispositionOptions = {}
): Promise<number | void> {
  if (!handle) {
    console.error(
      'Error: missing <task/case>. Usage: lumo task testcase disposition LUM-42/TC3 --known-defect'
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
  return testCaseDispositionInScope(
    taskScope(split.task),
    split.caseRef,
    options
  )
}

/**
 * LUM-1135: the same three-step handshake for any scope. On a milestone the
 * ruling clears the close gate instead of a task's DONE.
 */
export async function testCaseDispositionInScope(
  scope: TestCaseScope,
  caseRef: string,
  options: TestCaseDispositionOptions = {}
): Promise<number | void> {
  const handle = `${scope.label}/${caseRef}`

  const ruling = pickRuling(options, scope.kind)
  if (!ruling.ok) {
    console.error(`Error: ${ruling.error}`)
    return 1
  }
  const step = checkStep(options)
  if (!step.ok) {
    console.error(`Error: ${step.error}`)
    return 1
  }

  const ctx = apiContext()
  if (!ctx) return 1
  const note = options.note?.trim() || undefined
  const receipt = options.receipt?.trim()

  const shown = await apiCall<ShowResponse>(
    ctx,
    `${scope.basePath}/test-cases/${encodeURIComponent(caseRef)}`,
    {},
    'test case show'
  )
  if (!shown.ok || !shown.data) return 1

  const latest = shown.data.runs[0]
  if (!latest) {
    console.error(`Error: ${handle} has never been run — nothing to rule on.`)
    return 1
  }
  if (
    latest.result !== 'FAIL' ||
    latest.failureAttribution !== 'IMPLEMENTATION_DEFECT'
  ) {
    console.error(
      scope.kind === 'task'
        ? `Error: the latest run of ${handle} is not a proven implementation defect, so it never blocked DONE. Nothing to disposition.`
        : `Error: the latest run of ${handle} is not a proven implementation defect. Only proven defects can be dispositioned — every other failure holds the milestone until the case passes on a re-run. Nothing to disposition.`
    )
    return 1
  }
  if (latest.disposition) {
    process.stdout.write(
      `${handle}'s latest run is already dispositioned (${latest.disposition.disposition}) — nothing to do.\n`
    )
    return
  }

  const subject: DefectSubject = {
    caseHandle: `${scope.label}/TC${shown.data.testCase.number}`,
    caseTitle: shown.data.testCase.title,
    runId: latest.id,
    recordedAt: latest.createdAt,
    evidenceCount: Array.isArray(latest.evidence) ? latest.evidence.length : 0,
  }
  const receiptPath = `${scope.basePath}/test-case-runs/${encodeURIComponent(latest.id)}/disposition/receipt`

  // 步骤 1 —— 读信封。
  if (step.step === 'READ') {
    const issued = await apiCall<IssuedReceipt>(
      ctx,
      receiptPath,
      { method: 'POST', json: { disposition: ruling.target } },
      'read receipt'
    )
    if (!issued.ok || !issued.data) {
      console.error(
        'Error: could not obtain a read receipt for that run — nothing was written and no envelope can be issued.'
      )
      return 1
    }
    return emitConfirmation({
      command: `${scope.kind} testcase disposition`,
      changes: [
        ...describeDefectRead(subject, ruling.target, note, scope.kind),
        `Step 1 of 2 — read receipt issued for this run as read above (valid until ${issued.data.expiresAt}; void if a newer run is recorded or someone rules on it first). Next: the user confirms they have READ it, then run the command below; the ruling itself is confirmed in a second envelope`,
      ],
      confirmFlag: '--confirm-read',
      receipt: {
        token: issued.data.receipt,
        expiresAt: issued.data.expiresAt,
      },
    })
  }

  // 步骤 2 —— 确认已读,换 stage-2,打裁定信封。
  if (step.step === 'ACK') {
    const issued = await apiCall<IssuedReceipt>(
      ctx,
      receiptPath,
      {
        method: 'POST',
        json: { disposition: ruling.target, acknowledge: receipt },
      },
      'read acknowledgement'
    )
    if (!issued.ok || !issued.data) {
      console.error(
        'Error: read acknowledgement rejected — nothing was written.'
      )
      return 1
    }
    return emitConfirmation({
      command: `${scope.kind} testcase disposition`,
      changes: describeDefectRuling(
        subject,
        ruling.target,
        {
          readAt: issued.data.readAt,
          readAcknowledgedAt:
            issued.data.readAcknowledgedAt ?? issued.data.readAt,
          note,
        },
        scope.kind
      ),
      receipt: {
        token: issued.data.receipt,
        expiresAt: issued.data.expiresAt,
      },
    })
  }

  // 步骤 3 —— 落库。
  const wrote = await apiCall<{ disposition: DefectRuling }>(
    ctx,
    `${scope.basePath}/test-case-runs/${encodeURIComponent(latest.id)}/disposition`,
    {
      method: 'POST',
      json: { disposition: ruling.target, note: note ?? null, receipt },
    },
    'test case disposition'
  )
  if (!wrote.ok) return 1

  process.stdout.write(
    `Dispositioned ${subject.caseHandle}'s latest run: ${ruling.target}. ${
      scope.kind === 'task'
        ? 'That run no longer blocks DONE.'
        : ruling.target === 'KNOWN_DEFECT'
          ? 'That run no longer holds the milestone close gate.'
          : 'The case still holds the milestone close gate until it passes on a re-run.'
    }\n`
  )
  // LUM-842: show what (if anything) still blocks DONE after this ruling.
  if (scope.kind === 'task') {
    await printStatusDigest(ctx.base, ctx.token, scope.label)
  }
}
