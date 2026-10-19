'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useIntl } from 'react-intl'
import type { TestCaseRun } from '@prisma/client'
import type { TestCaseRunView } from '@/lib/api-client/test-cases'
import {
  deriveRunFreshness,
  type TaskPullRequestSnapshot,
} from '@/lib/test-cases/freshness'
import {
  countEvidence,
  deriveRunCeiling,
  type CeilingEnvironment,
} from '@/lib/test-cases/provability'
import { EvidenceStrip } from './TestCaseEvidence'
import { MemberHoverChip } from './MemberHoverChip'
import type { WorkspaceMemberInfo } from '../../types'
import { runAnchorId } from './taskTabs'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * LUM-801: 环境徽标。
 *
 * 必须**文字可分**，不只靠颜色——这是整个 feature 的目的：一眼看出这次是不是
 * 只在本地跑的。别把它简化成一个色点。边框形态（虚线 / 实线）再叠一层区分，
 * 供色觉差异的读者。
 */
export function EnvironmentBadge({
  environment,
}: {
  environment: TestCaseRun['environment']
}) {
  const intl = useIntl()
  return (
    <Badge
      variant={environment === 'PRODUCTION' ? 'outline' : 'outline-muted'}
      size='xs'
      shape='square'
      className={cn(
        'uppercase',
        environment === 'PRODUCTION' && 'border-foreground/50',
        environment === 'LOCAL' && 'border-dashed'
      )}
    >
      {intl.formatMessage({ id: `testCases.env.${environment}` })}
    </Badge>
  )
}

/**
 * 一条 run 的代码坐标。**从不**在数据缺失时渲染成「新鲜」——`unknown` 只打出
 * PR 号本身，不加任何「已是最新」的暗示（fail-closed，见 spec §3.1）。
 *
 * （这段注释刻意不写「井号 + 三位数字」的字面例子：lint-tokens 会把它读成
 * 十六进制色值。）
 */
export function CodeCoordinate({
  run,
  pullRequests,
}: {
  run: TestCaseRun
  pullRequests: TaskPullRequestSnapshot[]
}) {
  const intl = useIntl()
  if (!run.pullRequestId && !run.commitSha) return null
  const pr = pullRequests.find(p => p.id === run.pullRequestId) ?? null
  const freshness = deriveRunFreshness(run, pr)

  return (
    <span className='flex items-center gap-1 text-muted-foreground'>
      {pr ? <span>#{pr.number}</span> : null}
      {run.commitSha ? (
        <code className='font-mono'>@{run.commitSha.slice(0, 7)}</code>
      ) : null}
      {freshness.state === 'stale' && freshness.currentSha ? (
        <span className='text-foreground'>
          {intl.formatMessage(
            { id: 'testCases.freshness.stale' },
            { sha: freshness.currentSha.slice(0, 7) }
          )}
        </span>
      ) : null}
      {freshness.state === 'dirty' ? (
        <span className='text-foreground'>
          {intl.formatMessage({ id: 'testCases.freshness.dirty' })}
        </span>
      ) : null}
    </span>
  )
}

/**
 * LUM-1008: 谁跑的、从哪跑的。
 *
 * CLI 跑的 run 记下的成员是 token 主人，所以「人手动」还是「agent 代跑」要看
 * 有没有来源 session——有就给一个可点的短 id，指向那次 session 的时间线（能不
 * 能打开由 session 页自己判权限）。executedBy 为 null 读作「未记录」，不是
 * 「没人」；缺省（这个读端没带）就什么都不画。
 */
export function ExecutorLabel({
  executedBy,
  sourceSessionId,
  member = null,
}: {
  executedBy: string | null | undefined
  sourceSessionId: string | null
  /** LUM-1012: the runner, when they are a current member — drawn with
   *  avatar + hover card like everywhere else; otherwise the name label. */
  member?: WorkspaceMemberInfo | null
}) {
  const intl = useIntl()
  if (executedBy === undefined) return null
  return (
    <span className='flex items-center gap-1.5 text-muted-foreground'>
      {member ? (
        <MemberHoverChip member={member} />
      ) : (
        <span>
          {executedBy === null
            ? intl.formatMessage({ id: 'testCases.executor.unrecorded' })
            : intl.formatMessage(
                { id: 'testCases.executor.by' },
                { name: executedBy }
              )}
        </span>
      )}
      {sourceSessionId ? (
        <Link
          href={`/sessions/${sourceSessionId}`}
          className='underline-offset-2 hover:text-foreground hover:underline'
        >
          {intl.formatMessage(
            { id: 'testCases.executor.session' },
            { id: sourceSessionId.slice(0, 8) }
          )}
        </Link>
      ) : null}
    </span>
  )
}

/**
 * LUM-808: run 的**判决**——不是它上报的结果，是受本次能力边界封顶之后的结论。
 *
 * 一条报了 PASS 却验不了目标环境的 run，和一个真 PASS 在库里长得一模一样；
 * 这个徽章就是让它们在屏幕上长得不一样。UNPROVEN 不是失败，措辞上要与 FAIL
 * 分开——它说的是「没能确认」。
 */
export function VerdictBadge({
  run,
  requiredEnvironment,
}: {
  run: TestCaseRun
  requiredEnvironment: CeilingEnvironment | null
}) {
  const intl = useIntl()
  const ceiling = deriveRunCeiling(
    {
      result: run.result,
      environment: run.environment,
      unprovenVerification: (run.unprovenVerification ??
        []) as unknown as Array<{ index: number; text: string }>,
      evidenceCount: countEvidence(run.evidence),
      stepResults: run.stepResults,
    },
    { requiredEnvironment }
  )

  if (ceiling.effective !== 'UNPROVEN') {
    return (
      <span className='text-body-strong text-foreground'>
        {intl.formatMessage({ id: `testCases.result.${run.result}` })}
      </span>
    )
  }

  const why =
    ceiling.reason === 'environment'
      ? intl.formatMessage(
          { id: 'testCases.ceiling.environment' },
          {
            env: intl.formatMessage({
              id: `testCases.env.${ceiling.requiredEnvironment}`,
            }),
          }
        )
      : ceiling.reason === 'unobserved'
        ? intl.formatMessage(
            { id: 'testCases.ceiling.unobserved' },
            { count: ceiling.unobserved.length }
          )
        : ceiling.reason === 'skipped'
          ? intl.formatMessage(
              { id: 'testCases.ceiling.skipped' },
              { count: ceiling.skipped.length }
            )
          : intl.formatMessage({ id: 'testCases.ceiling.noEvidence' })

  return (
    <span className='flex flex-wrap items-baseline gap-1'>
      <span className='text-muted-foreground line-through'>
        {intl.formatMessage({ id: `testCases.result.${run.result}` })}
      </span>
      <span className='text-body-strong text-foreground'>
        {intl.formatMessage({ id: 'testCases.result.UNPROVEN' })}
      </span>
      <span className='text-muted-foreground'>{why}</span>
    </span>
  )
}

/** LUM-808: 一条 FAIL 是谁的锅。非 FAIL 不渲染。 */
export function AttributionBadge({ run }: { run: TestCaseRun }) {
  const intl = useIntl()
  if (!run.failureAttribution) return null
  return (
    <Badge
      variant='outline-muted'
      size='xs'
      shape='square'
      className='uppercase'
    >
      {intl.formatMessage({
        id: `testCases.cause.${run.failureAttribution}`,
      })}
    </Badge>
  )
}

/**
 * LUM-812: 一条已裁定的 run 上的那枚徽章。
 *
 * 裁定过的缺陷**仍然显示**——清掉的是「拦」，不是「有这回事」。
 */
export function DispositionBadge({ run }: { run: TestCaseRunView }) {
  const intl = useIntl()
  if (!run.disposition) return null
  return (
    <Badge
      variant='outline-muted'
      size='xs'
      shape='square'
      className='uppercase'
    >
      {intl.formatMessage({
        id: `testCases.disposition.${run.disposition.disposition}`,
      })}
    </Badge>
  )
}

/**
 * LUM-819 返工：从 run 深链进来时（`…/tests#run-<id>`），把那条 run 滚进
 * 视野并标出来。hash 在挂载后才读得到、且用例列表是异步加载的，所以在
 * effect 里读，不在 render 里读（render 纯度）。
 */
function useLinkedRunId(runs: TestCaseRunView[]): string | null {
  const [linked, setLinked] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const hit = runs.find(r => window.location.hash === `#${runAnchorId(r.id)}`)
    if (!hit) return
    setLinked(hit.id)
    // 瞬时跳转，不用 smooth：锚点落地的惯例本来就是直接到位；几千像素的平滑
    // 滚动既慢，又依赖动画真的播放（页面在后台 / 不合成帧时它原地不动——
    // LUM-819 生产复查时实测 scrollTop 两秒后仍为 0）。
    document
      .getElementById(runAnchorId(hit.id))
      ?.scrollIntoView?.({ block: 'center' })
  }, [runs])
  return linked
}

/** 这条 run 是不是「已证明为坏、还没人裁定」。 */
export function isUndispositionedDefect(run: TestCaseRunView): boolean {
  return (
    run.result === 'FAIL' &&
    run.failureAttribution === 'IMPLEMENTATION_DEFECT' &&
    run.disposition === null
  )
}

/**
 * 哪条 run 该挂裁定按钮——至多一条：该用例**最新**的那条，且它是未裁定的已证缺陷。
 *
 * 闸门只读每条用例最新一条 run，服务端也拒绝对非最新 run 下裁定（409，裁了也
 * 清不掉任何东西）。在更早的未裁定 defect run 上挂「Blocking DONE」+ 按钮，
 * 既说错了（它不拦），点下去也只会报错（LUM-812/TC1 生产复跑发现）。
 *
 * 按 createdAt 取最新，不依赖调用方传入的顺序。
 */
export function ruleableRunId(runs: TestCaseRunView[]): string | null {
  let latest: TestCaseRunView | null = null
  for (const r of runs) {
    // 类型上是 Date，JSON 过来的运行时是字符串 —— new Date() 两者都吃。
    if (
      !latest ||
      new Date(r.createdAt).getTime() > new Date(latest.createdAt).getTime()
    )
      latest = r
  }
  return latest && isUndispositionedDefect(latest) ? latest.id : null
}

/**
 * LUM-812: 未裁定的已证缺陷上的两个按钮。
 *
 * 两个值都清闸，所以并排放、不分主次——把其中一个做成主按钮，等于暗示有个
 * 「正确答案」，而这里要的是人真的读一眼再选。
 */
export type TestCaseOwnerKind = 'task' | 'milestone'

export function DisposeControl({
  runId,
  onDispose,
  ownerKind = 'task',
}: {
  runId: string
  onDispose: (runId: string, ruling: 'KNOWN_DEFECT' | 'NOT_A_DEFECT') => void
  /**
   * LUM-1135: 里程碑上两个裁定的后果不对称——「已知缺陷」放行关闭闸，「不是
   * 缺陷」让这条用例继续拦着、直到重跑通过。所以里程碑要把后果写出来。
   */
  ownerKind?: TestCaseOwnerKind
}) {
  const intl = useIntl()
  const milestone = ownerKind === 'milestone'
  return (
    <span className='flex flex-wrap items-center gap-x-2 gap-y-0.5'>
      <span className='text-muted-foreground'>
        {intl.formatMessage({
          id: milestone
            ? 'testCases.disposition.blockingMilestone'
            : 'testCases.disposition.blocking',
        })}
      </span>
      {(['KNOWN_DEFECT', 'NOT_A_DEFECT'] as const).map(ruling => (
        <button
          key={ruling}
          type='button'
          onClick={() => onDispose(runId, ruling)}
          className='text-foreground underline-offset-2 hover:underline'
        >
          {intl.formatMessage({
            id: milestone
              ? `testCases.disposition.${ruling}`
              : `testCases.disposition.action.${ruling}`,
          })}
        </button>
      ))}
      {milestone ? (
        <span
          data-testid='dispose-consequence'
          className='basis-full text-muted-foreground'
        >
          {intl.formatMessage({
            id: 'testCases.disposition.milestoneConsequence',
          })}
        </span>
      ) : null}
    </span>
  )
}

export function RunHistoryList({
  runs,
  pullRequests,
  requiredEnvironment,
  onDispose,
  ownerKind = 'task',
}: {
  runs: TestCaseRunView[]
  pullRequests: TaskPullRequestSnapshot[]
  /** 用例的目标环境（扁平传入，不从 run 反向摸用例——LoD）。 */
  requiredEnvironment: CeilingEnvironment | null
  /** 落裁定。缺省 = 这个读端不提供裁定入口。 */
  onDispose?: (runId: string, ruling: 'KNOWN_DEFECT' | 'NOT_A_DEFECT') => void
  /** 用例属于任务还是里程碑——只决定裁定入口的文案。 */
  ownerKind?: TestCaseOwnerKind
}) {
  const intl = useIntl()
  const linkedRunId = useLinkedRunId(runs)
  if (runs.length === 0) {
    return (
      <p className='text-caption text-muted-foreground'>
        {intl.formatMessage({ id: 'testCases.neverRun' })}
      </p>
    )
  }
  const ruleable = onDispose ? ruleableRunId(runs) : null
  return (
    <ul className='flex flex-col gap-1.5'>
      {runs.map(r => {
        // failedIndex 存的是 0-based，显示回 1-based（与步骤编号对齐）。
        const locator =
          r.failedPhase && r.failedIndex !== null
            ? intl.formatMessage(
                {
                  id:
                    r.failedPhase === 'STEPS'
                      ? 'testCases.failedAt.step'
                      : 'testCases.failedAt.verification',
                },
                { n: r.failedIndex + 1 }
              )
            : null
        return (
          <li
            key={r.id}
            id={runAnchorId(r.id)}
            className={
              'flex flex-wrap items-center gap-2 text-caption' +
              (r.id === linkedRunId
                ? ' rounded-sm outline outline-1 outline-offset-4 outline-border'
                : '')
            }
          >
            <VerdictBadge run={r} requiredEnvironment={requiredEnvironment} />
            <EnvironmentBadge environment={r.environment} />
            <AttributionBadge run={r} />
            <DispositionBadge run={r} />
            {onDispose && r.id === ruleable ? (
              <DisposeControl
                runId={r.id}
                onDispose={onDispose}
                ownerKind={ownerKind}
              />
            ) : null}
            <time className='text-muted-foreground'>
              {new Date(r.createdAt).toISOString().slice(0, 10)}
            </time>
            <ExecutorLabel
              executedBy={r.executedBy}
              sourceSessionId={r.sourceSessionId}
            />
            <CodeCoordinate run={r} pullRequests={pullRequests} />
            {locator ? (
              <span className='text-muted-foreground'>
                {locator}
                {r.failedStepText ? ` — ${r.failedStepText}` : ''}
              </span>
            ) : null}
            {r.note ? (
              <span className='text-muted-foreground'>{r.note}</span>
            ) : null}
            <EvidenceStrip evidence={r.evidence} />
          </li>
        )
      })}
    </ul>
  )
}
