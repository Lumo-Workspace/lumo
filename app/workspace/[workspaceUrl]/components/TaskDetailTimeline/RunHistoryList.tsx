'use client'

import { useIntl } from 'react-intl'
import type { TestCaseRun } from '@prisma/client'
import {
  deriveRunFreshness,
  type TaskPullRequestSnapshot,
} from '@/lib/test-cases/freshness'

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

export function RunHistoryList({
  runs,
  pullRequests,
}: {
  runs: TestCaseRun[]
  pullRequests: TaskPullRequestSnapshot[]
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
        const evidence = Array.isArray(r.evidence) ? r.evidence : []
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
            <span className='text-body-strong text-foreground'>
              {intl.formatMessage({ id: `testCases.result.${r.result}` })}
            </span>
            <EnvironmentBadge environment={r.environment} />
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
            {evidence.length > 0 ? (
              <span className='text-muted-foreground'>
                {intl.formatMessage(
                  { id: 'testCases.evidence' },
                  { count: evidence.length }
                )}
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
