'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import type { ReviewPoolItem, ReviewPoolView } from '@/lib/api-client'
import type { FalseReportRate } from '@/lib/test-cases/review'
import { PageBreadcrumb } from '../PageBreadcrumb'
import { AsyncContent } from '../AsyncContent'
import { EvidenceStrip } from '../TaskDetailTimeline/TestCaseEvidence'
import { testRunHref } from '../TaskDetailTimeline/taskTabs'

interface RunReviewViewProps {
  workspaceUrl: string
  pool: ReviewPoolView | null
  loading: boolean
  error: string | null
  onReload: () => void
  /** 正在提交复核的那条 run（按钮置灰用）。 */
  reviewingRunId: string | null
  /** 上一次复核提交失败的原因。 */
  reviewError: string | null
  onReview: (runId: string, accepted: boolean, note: string | null) => void
}

/**
 * LUM-819 (D): 抽查页（纯展示）。
 *
 * 三条设计约束，别改掉：
 * - 每条 run 的**证据排在两个按钮之前**——先看证据再裁定，是这个页面的全部
 *   意义；能不看证据就点的布局等于把抽查退化成盖章。
 * - **证据要和对照物放在一起**（LUM-819 返工）：预期结果最显眼，其次是它为
 *   哪条验收标准作证、步骤与复验条目；再多的上下文一键跳进任务看。没有对照物，
 *   复核只能判断证据「像不像样」，判断不了「证没证明」。
 * - 虚报率**永远带分子分母**；样本不足时明说不足，不给百分比。
 */
export function RunReviewView({
  workspaceUrl,
  pool,
  loading,
  error,
  onReload,
  reviewingRunId,
  reviewError,
  onReview,
}: RunReviewViewProps) {
  const intl = useIntl()
  const sample = pool?.sample ?? []

  return (
    <div className='flex h-full flex-col overflow-hidden'>
      <PageBreadcrumb title={intl.formatMessage({ id: 'runReviews.title' })} />

      <div className='flex-1 overflow-y-auto px-4 pb-20 pt-6 md:px-8'>
        <div className='mx-auto flex w-full max-w-[960px] flex-col gap-6'>
          <p className='text-sm text-muted-foreground'>
            {intl.formatMessage({ id: 'runReviews.blurb' })}
          </p>

          {pool && <RateReadout rate={pool.rate} />}

          {reviewError && (
            <p role='alert' className='text-sm text-destructive'>
              {intl.formatMessage(
                { id: 'runReviews.error.review' },
                { reason: reviewError }
              )}
            </p>
          )}

          <AsyncContent
            loading={loading}
            error={error}
            empty={sample.length === 0}
            onRetry={onReload}
            emptyState={
              <p className='py-10 text-center text-sm text-muted-foreground'>
                {intl.formatMessage({ id: 'runReviews.pool.empty' })}
              </p>
            }
          >
            <div className='flex items-center gap-3'>
              <p className='text-sm text-muted-foreground'>
                {intl.formatMessage(
                  { id: 'runReviews.pool.summary' },
                  { poolSize: pool?.poolSize ?? 0, count: sample.length }
                )}
              </p>
              <span className='flex-1' />
              <Button variant='ghost' size='sm' onClick={onReload}>
                {intl.formatMessage({ id: 'runReviews.pool.resample' })}
              </Button>
            </div>
            <ul className='flex flex-col gap-3'>
              {sample.map(item => (
                <ReviewItem
                  key={item.runId}
                  item={item}
                  taskHref={testRunHref(
                    workspaceUrl,
                    item.taskIdentifier,
                    item.runId
                  )}
                  busy={reviewingRunId === item.runId}
                  onReview={onReview}
                />
              ))}
            </ul>
          </AsyncContent>
        </div>
      </div>
    </div>
  )
}

/** 虚报率读数：分子分母总在；样本不足时只报计数。 */
export function RateReadout({ rate }: { rate: FalseReportRate }) {
  const intl = useIntl()
  const text =
    rate.status === 'measured'
      ? intl.formatMessage(
          { id: 'runReviews.rate.measured' },
          {
            rejected: rate.rejected,
            reviewed: rate.reviewed,
            percent: intl.formatNumber(rate.rate, {
              style: 'percent',
              maximumFractionDigits: 0,
            }),
          }
        )
      : intl.formatMessage(
          { id: 'runReviews.rate.insufficient' },
          {
            rejected: rate.rejected,
            reviewed: rate.reviewed,
            minSample: rate.minSample,
          }
        )
  return (
    <section
      aria-label={intl.formatMessage({ id: 'runReviews.rate.label' })}
      className='rounded-md border border-border px-4 py-3'
    >
      <p className='text-body-strong text-foreground'>
        {intl.formatMessage({ id: 'runReviews.rate.label' })}
      </p>
      <p className='text-sm text-muted-foreground'>{text}</p>
    </section>
  )
}

/** 用例剧本：前置、步骤、复验条目。默认收起——预期结果已在卡片上。 */
function ScriptDetails({ item }: { item: ReviewPoolItem }) {
  const intl = useIntl()
  const section = (labelId: string, lines: string[]) =>
    lines.length === 0 ? null : (
      <div className='flex flex-col gap-0.5'>
        <p className='text-muted-foreground'>
          {intl.formatMessage({ id: labelId })}
        </p>
        <ol className='list-decimal pl-5 text-foreground'>
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      </div>
    )
  return (
    <details className='text-sm'>
      <summary className='cursor-pointer text-muted-foreground'>
        {intl.formatMessage(
          { id: 'runReviews.item.script' },
          { steps: item.steps.length, verification: item.verification.length }
        )}
      </summary>
      <div className='flex flex-col gap-2 pt-2'>
        {item.setup ? (
          <div className='flex flex-col gap-0.5'>
            <p className='text-muted-foreground'>
              {intl.formatMessage({ id: 'runReviews.item.setup' })}
            </p>
            <p className='text-foreground'>{item.setup}</p>
          </div>
        ) : null}
        {section('runReviews.item.steps', item.steps)}
        {section('runReviews.item.verification', item.verification)}
      </div>
    </details>
  )
}

function ReviewItem({
  item,
  taskHref,
  busy,
  onReview,
}: {
  item: ReviewPoolItem
  /** 深链到该任务 Tests 标签、定位到这条 run（父组件算好，LoD）。 */
  taskHref: string
  busy: boolean
  onReview: (runId: string, accepted: boolean, note: string | null) => void
}) {
  const intl = useIntl()
  const [note, setNote] = useState('')
  const noteOrNull = note.trim() || null

  return (
    <li className='flex flex-col gap-2 rounded-md border border-border px-4 py-3'>
      <p className='text-body-strong text-foreground'>
        {item.taskIdentifier} · TC{item.caseNumber} {item.caseTitle}
      </p>
      <p className='text-sm text-muted-foreground'>
        {item.taskTitle} ·{' '}
        {intl.formatMessage(
          { id: 'runReviews.item.recorded' },
          {
            env: intl.formatMessage({
              id: `testCases.env.${item.environment}`,
            }),
            date: intl.formatDate(item.recordedAt, {
              dateStyle: 'medium',
            }),
          }
        )}
        {item.commitSha &&
          ` · @${item.commitSha.slice(0, 7)}${item.commitDirty ? '+dirty' : ''}`}
        {item.pr ? (
          <>
            {' · '}
            <a
              href={item.pr.url}
              target='_blank'
              rel='noreferrer'
              className='underline-offset-2 hover:underline'
            >
              {intl.formatMessage(
                { id: 'runReviews.item.pr' },
                { number: item.pr.number }
              )}
            </a>
          </>
        ) : null}
      </p>

      {/* 对照物：预期结果最显眼。 */}
      <div className='flex flex-col gap-0.5 rounded-md border border-border px-3 py-2'>
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'runReviews.item.expected' })}
        </p>
        <p className='text-body-strong text-foreground'>{item.expected}</p>
      </div>
      <ScriptDetails item={item} />

      {item.note && <p className='text-sm text-foreground'>“{item.note}”</p>}

      {/* 证据在前，按钮在后——先看再裁。 */}
      <p className='text-sm text-muted-foreground'>
        {intl.formatMessage({ id: 'runReviews.item.evidenceLead' })}
      </p>
      <EvidenceStrip evidence={item.evidence} />

      <div className='flex flex-wrap items-center gap-2 pt-1'>
        <input
          className='min-w-0 basis-full rounded-md border border-border bg-background px-2 py-1 text-sm sm:basis-0 sm:flex-1'
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder={intl.formatMessage({
            id: 'runReviews.item.notePlaceholder',
          })}
          aria-label={intl.formatMessage({
            id: 'runReviews.item.notePlaceholder',
          })}
        />
        <Button
          size='sm'
          variant='outline'
          disabled={busy}
          onClick={() => onReview(item.runId, true, noteOrNull)}
        >
          {intl.formatMessage({ id: 'runReviews.action.accept' })}
        </Button>
        <Button
          size='sm'
          variant='outline'
          disabled={busy}
          onClick={() => onReview(item.runId, false, noteOrNull)}
        >
          {intl.formatMessage({ id: 'runReviews.action.reject' })}
        </Button>
        <a
          href={taskHref}
          className='text-sm text-muted-foreground underline-offset-2 hover:underline'
        >
          {intl.formatMessage({ id: 'runReviews.item.openInTask' })}
        </a>
      </div>
    </li>
  )
}
