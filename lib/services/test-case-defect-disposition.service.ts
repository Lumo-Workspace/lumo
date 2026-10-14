/**
 * LUM-812: 对一条「证明了坏」的 test case run 下人类裁定——第四条 DONE 拦截面
 * 的唯一清闸口。
 *
 * ## 这里拦的是什么
 *
 * 闸门拦的是「**没人拍过板**」，不是「缺陷还在」。两个裁定值都清闸（同越界的
 * FALSE_POSITIVE / CONFIRMED 都清闸）：`KNOWN_DEFECT` 是「认了，照发」，
 * `NOT_A_DEFECT` 是「归因错了」。要求先修好才放行会把这一面变成硬墙，而硬墙
 * 会逆向激励「干脆不记 run」——那正是 LUM-801 当初不让用例进闸的理由。
 *
 * ## 服务端**不做** agent 身份守卫
 *
 * LUM-750 曾加过「agent 会话不得处置 + SELF_DISPOSITION 检测回滚」，同日被用户
 * 要求撤回（PR 1006）：用户的实际工作流就是让 agent 代跑握手、自己在聊天里逐步
 * 批准，守卫把这条路堵死了。**别再自行加回来**——产品决定未定。
 *
 * 保护来自另外两处，都不依赖「你是谁」：
 *   1. LUM-769 的三步握手，顺序由服务端的 receipt 强制（见 issue/acknowledge/verify）；
 *   2. `channel` 留痕——CLI 走完握手**也证明不了人本人点的头**（agent 在转述
 *      每一步），所以写下来的行必须说清它是从哪条路进来的。
 */
import { createHash } from 'crypto'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import {
  acknowledgeReadReceipt,
  issueReadReceipt,
  readReceiptSecret,
  receiptRefusal,
  verifyReadReceipt,
  type IssuedReceipt,
  type ReceiptSubject,
} from '@/lib/disposition/read-receipt'
import {
  recordAuditEvent,
  type WorkspaceAudit,
} from '@/lib/services/audit.service'

export type DefectRuling = 'KNOWN_DEFECT' | 'NOT_A_DEFECT'
export type DispositionChannel = 'WEB' | 'CLI'

/** LUM-1135: a run belongs to a task or (cross-task E2E) to a milestone. */
export type DispositionOwner =
  | { kind: 'task'; taskId: string }
  | { kind: 'milestone'; milestoneId: string }

/** 回执只需要一个稳定的 scope 串（只参与签名，从不反查）。 */
function ownerScope(owner: DispositionOwner): string {
  return owner.kind === 'task' ? owner.taskId : `milestone:${owner.milestoneId}`
}

/** 谁在请求 / 出示回执。与越界侧同形。 */
export interface ReceiptCaller {
  sessionId: string | null
  memberId: string
}

function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status })
}

/** 证据数组里有没有东西——IMPLEMENTATION_DEFECT 的举证责任在写 run 时已强制。 */
function hasEvidence(evidence: unknown): boolean {
  return Array.isArray(evidence) && evidence.length > 0
}

/**
 * 可裁定的 run，或者一个说明白为什么不行的错误。
 *
 * 四道闸，顺序即信息量：不存在 → 用例已删 → 不是「证明了坏」→ 已经不是最新。
 */
async function loadRuleableRun(owner: DispositionOwner, runId: string) {
  const run = await testCaseRepository.findRunForDisposition(runId)
  const owned =
    owner.kind === 'task'
      ? run?.taskId === owner.taskId
      : run?.milestoneId === owner.milestoneId
  if (!run || !owned) {
    fail(`Test case run not found on this ${owner.kind}.`, 404)
  }
  if (run.testCase.deletedAt) {
    fail('That test case has been removed.', 409)
  }
  if (
    run.result !== 'FAIL' ||
    run.failureAttribution !== 'IMPLEMENTATION_DEFECT' ||
    !hasEvidence(run.evidence)
  ) {
    fail(
      owner.kind === 'task'
        ? 'Only a run that proved an implementation defect with evidence can be dispositioned — ' +
            'every other outcome is advisory and never blocked DONE in the first place.'
        : 'Only a run that proved an implementation defect with evidence can be dispositioned. ' +
            'Other failures hold the milestone until the case passes.',
      409
    )
  }
  if (!run.isLatestForCase) {
    fail(
      'That run is no longer the latest for this test case, so ruling on it would clear nothing. ' +
        'Disposition the latest run instead.',
      409
    )
  }
  return run
}

/**
 * receipt 绑定的状态。
 *
 * run 本身是 append-only、不可变的，所以真正会动的是另外两样：**已有裁定**，
 * 以及**这条 run 还是不是最新的**。后者尤其要命——读完信封到确认之间有人 append
 * 了一条新 run，旧那条的裁定就清不掉闸了，此时未确认的 receipt 必须失效。
 */
function runStateHash(run: {
  id: string
  disposition: { id: string } | null
  isLatestForCase: boolean
}): string {
  const canonical = JSON.stringify([
    run.id,
    run.disposition?.id ?? null,
    run.isLatestForCase,
  ])
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

function requireReceiptSecret(): string {
  const secret = readReceiptSecret()
  if (!secret) {
    fail(
      'Read-receipt signing is not configured on this server (LUMO_RECEIPT_SECRET / CRON_SECRET) — CLI dispositions are unavailable; use the web panel',
      503
    )
  }
  return secret
}

export const testCaseDefectDispositionService = {
  /** 信封要展示的那条 run（读端；不写任何东西）。 */
  async describe(owner: DispositionOwner, runId: string) {
    const run = await loadRuleableRun(owner, runId)
    return {
      runId: run.id,
      caseNumber: run.testCase.number,
      caseTitle: run.testCase.title,
      recordedAt: run.createdAt,
      evidenceCount: Array.isArray(run.evidence) ? run.evidence.length : 0,
      alreadyDispositioned: run.disposition !== null,
    }
  },

  async receiptSubject(
    owner: DispositionOwner,
    runId: string,
    target: DefectRuling,
    caller: ReceiptCaller
  ): Promise<ReceiptSubject> {
    const run = await loadRuleableRun(owner, runId)
    return {
      kind: 'TEST_CASE_DEFECT',
      subjectId: run.id,
      taskId: ownerScope(owner),
      target,
      sessionId: caller.sessionId,
      memberId: caller.memberId,
      stateHash: runStateHash(run),
    }
  },

  /** 步骤 1：签一张 stage-1 回执。不写任何东西。 */
  async issueReadReceipt(
    owner: DispositionOwner,
    runId: string,
    target: DefectRuling,
    caller: ReceiptCaller
  ): Promise<IssuedReceipt> {
    const subject = await this.receiptSubject(owner, runId, target, caller)
    return issueReadReceipt(requireReceiptSecret(), subject)
  },

  /** 步骤 2：用户说读过了。校验 stage-1、换发 stage-2。不写任何东西。 */
  async acknowledgeReadReceipt(
    owner: DispositionOwner,
    runId: string,
    target: DefectRuling,
    receipt: string,
    caller: ReceiptCaller
  ): Promise<IssuedReceipt> {
    const subject = await this.receiptSubject(owner, runId, target, caller)
    const out = acknowledgeReadReceipt(requireReceiptSecret(), receipt, subject)
    if (out.ok) return out.issued
    throw receiptRefusal(out, '--confirm-read', 'test case run')
  },

  /**
   * 步骤 3：落裁定。
   *
   * CLI 来路必须出示 **stage-2** 回执——拿 stage-1 来（读过但没确认读过）一律
   * 409 `not_acknowledged`，顺序不是 CLI 自觉遵守的，是服务端算出来的。
   * WEB 来路没有回执：面板上就是那个人自己在点。
   */
  async rule(input: {
    owner: DispositionOwner
    runId: string
    ruling: DefectRuling
    note?: string | null | undefined
    caller: ReceiptCaller
    channel: DispositionChannel
    receipt?: string | undefined
    /** LUM-907: the workspace audit log entry for this ruling (required —
     *  a ruling is always audited). */
    audit: WorkspaceAudit
  }) {
    const { owner, runId, ruling, caller, channel } = input
    const run = await loadRuleableRun(owner, runId)
    if (run.disposition) {
      fail('That run has already been dispositioned.', 409)
    }

    let handshake: { readAt: string; readAcknowledgedAt: string } | null = null
    if (channel === 'CLI') {
      if (!input.receipt) {
        fail(
          'A CLI ruling must present the read receipt from --confirm-read.',
          400
        )
      }
      const verdict = verifyReadReceipt(
        requireReceiptSecret(),
        input.receipt,
        await this.receiptSubject(owner, runId, ruling, caller),
        new Date(),
        { requireStage: 'ACK' }
      )
      if (!verdict.ok)
        throw receiptRefusal(verdict, '--confirm', 'test case run')
      handshake = {
        readAt: verdict.readAt,
        readAcknowledgedAt: verdict.readAcknowledgedAt ?? verdict.readAt,
      }
    }

    // TaskActivity.actorId 指向 Actor，不是 Member —— 直接塞 memberId 会撞
    // task_activities_actorId_fkey（LUM-812/TC1 生产 500 的根因）。解析方式同越界侧。
    const actor = await memberRepository.findActorByMemberId(caller.memberId)
    const note = input.note?.trim() || null

    // 行存最新状态，事件流存全历史（同 CRITERION_CHANGED 的分工）；两者同事务。
    const created = await testCaseRepository.createDisposition(
      {
        runId,
        taskId: owner.kind === 'task' ? owner.taskId : null,
        milestoneId: owner.kind === 'milestone' ? owner.milestoneId : null,
        disposition: ruling,
        note,
        dispositionedById: caller.memberId,
        channel,
      },
      // 里程碑 run 没有 task 时间线可写。
      owner.kind === 'task'
        ? {
            actorId: actor?.id ?? null,
            payload: {
              runId,
              caseNumber: run.testCase.number,
              caseTitle: run.testCase.title,
              disposition: ruling,
              note,
              channel,
              ...(handshake ?? {}),
            },
          }
        : null
    )
    // LUM-907：事务提交后再记审计（只记 id 与枚举值，备注与用例标题不进审计日志）。
    await recordAuditEvent({
      workspaceId: input.audit.workspaceId,
      action: 'test_case_defect.dispositioned',
      target: { type: 'test_case_run', id: runId },
      metadata: {
        ...(owner.kind === 'task'
          ? { taskId: owner.taskId }
          : { milestoneId: owner.milestoneId }),
        caseNumber: run.testCase.number,
        disposition: ruling,
        channel,
      },
      context: input.audit.context,
    })
    if (owner.kind === 'milestone') {
      const { milestoneRollupService } =
        await import('@/lib/services/milestone-rollup.service')
      milestoneRollupService.dispatchRollup(owner.milestoneId)
    }
    return created
  },
}
