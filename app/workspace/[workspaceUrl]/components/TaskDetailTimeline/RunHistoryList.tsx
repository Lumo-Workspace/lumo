'use client'

import { useIntl } from 'react-intl'
import type { TestCaseRun } from '@prisma/client'
import type { TestCaseRunView } from '@/lib/api-client/test-cases'
import {
  deriveRunFreshness,
  type TaskPullRequestSnapshot,
} from '@/lib/test-cases/freshness'
import {
  deriveRunCeiling,
  type CeilingEnvironment,
} from '@/lib/test-cases/provability'
import { EvidenceStrip } from './TestCaseEvidence'

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
  const tone =
    environment === 'PRODUCTION'
      ? 'border-solid border-foreground/50 text-foreground'
      : environment === 'PREVIEW'
        ? 'border-solid border-border text-muted-foreground'
        : 'border-dashed border-border text-muted-foreground'
  return (
    <span
      className={`rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}
    >
      {intl.formatMessage({ id: `testCases.env.${environment}` })}
    </span>
  )
}

/**
 * 一条 run 的代码坐标。**从不**在数据缺失时渲染成「新鲜」——`unknown` 只打出
 * PR 号本身，不加任何「已是最新」的暗示（fail-closed，见 spec §3.1）。
 *
 * （这段注释刻意不写「井号 + 三位数字」的字面例子：lint-tokens 会把它读成
 * 十六进制色值。）
 */
function CodeCoordinate({
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
 * LUM-808: run 的**判决**——不是它上报的结果，是受本次能力边界封顶之后的结论。
 *
 * 一条报了 PASS 却验不了目标环境的 run，和一个真 PASS 在库里长得一模一样；
 * 这个徽章就是让它们在屏幕上长得不一样。UNPROVEN 不是失败，措辞上要与 FAIL
 * 分开——它说的是「没能确认」。
 */
function VerdictBadge({
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
      : intl.formatMessage(
          { id: 'testCases.ceiling.unobserved' },
          { count: ceiling.unobserved.length }
        )

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
function AttributionBadge({ run }: { run: TestCaseRun }) {
  const intl = useIntl()
  if (!run.failureAttribution) return null
  return (
    <span className='rounded-sm border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground'>
      {intl.formatMessage({
        id: `testCases.cause.${run.failureAttribution}`,
      })}
    </span>
  )
}

/**
 * LUM-812: 一条已裁定的 run 上的那枚徽章。
 *
 * 裁定过的缺陷**仍然显示**——清掉的是「拦」，不是「有这回事」。
 */
function DispositionBadge({ run }: { run: TestCaseRunView }) {
  const intl = useIntl()
  if (!run.disposition) return null
  return (
    <span className='rounded-sm border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground'>
      {intl.formatMessage({
        id: `testCases.disposition.${run.disposition.disposition}`,
      })}
    </span>
  )
}

/** 这条 run 是不是「已证明为坏、还没人裁定」——唯一会拦 DONE 的形态。 */
function isUndispositionedDefect(run: TestCaseRunView): boolean {
  return (
    run.result === 'FAIL' &&
    run.failureAttribution === 'IMPLEMENTATION_DEFECT' &&
    run.disposition === null
  )
}

/**
 * LUM-812: 未裁定的已证缺陷上的两个按钮。
 *
 * 两个值都清闸，所以并排放、不分主次——把其中一个做成主按钮，等于暗示有个
 * 「正确答案」，而这里要的是人真的读一眼再选。
 */
function DisposeControl({
  runId,
  onDispose,
}: {
  runId: string
  onDispose: (runId: string, ruling: 'KNOWN_DEFECT' | 'NOT_A_DEFECT') => void
}) {
  const intl = useIntl()
  return (
    <span className='flex items-center gap-2'>
      <span className='text-muted-foreground'>
        {intl.formatMessage({ id: 'testCases.disposition.blocking' })}
      </span>
      {(['KNOWN_DEFECT', 'NOT_A_DEFECT'] as const).map(ruling => (
        <button
          key={ruling}
          type='button'
          onClick={() => onDispose(runId, ruling)}
          className='text-foreground underline-offset-2 hover:underline'
        >
          {intl.formatMessage({ id: `testCases.disposition.action.${ruling}` })}
        </button>
      ))}
    </span>
  )
}

export function RunHistoryList({
  runs,
  pullRequests,
  requiredEnvironment,
  onDispose,
}: {
  runs: TestCaseRunView[]
  pullRequests: TaskPullRequestSnapshot[]
  /** 用例的目标环境（扁平传入，不从 run 反向摸用例——LoD）。 */
  requiredEnvironment: CeilingEnvironment | null
  /** 落裁定。缺省 = 这个读端不提供裁定入口。 */
  onDispose?: (runId: string, ruling: 'KNOWN_DEFECT' | 'NOT_A_DEFECT') => void
}) {
  const intl = useIntl()
  if (runs.length === 0) {
    return (
      <p className='text-[11px] text-muted-foreground'>
        {intl.formatMessage({ id: 'testCases.neverRun' })}
      </p>
    )
  }
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
            className='flex flex-wrap items-center gap-2 text-[11px]'
          >
            <VerdictBadge run={r} requiredEnvironment={requiredEnvironment} />
            <EnvironmentBadge environment={r.environment} />
            <AttributionBadge run={r} />
            <DispositionBadge run={r} />
            {onDispose && isUndispositionedDefect(r) ? (
              <DisposeControl runId={r.id} onDispose={onDispose} />
            ) : null}
            <time className='text-muted-foreground'>
              {new Date(r.createdAt).toISOString().slice(0, 10)}
            </time>
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
