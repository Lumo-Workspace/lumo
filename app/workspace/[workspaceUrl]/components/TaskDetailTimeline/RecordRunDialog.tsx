'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import type { TestCase } from '@prisma/client'
import type { RecordRunBody } from '@/lib/validation/test-case'
import type { TaskPullRequestSnapshot } from '@/lib/test-cases/freshness'

const RESULTS = ['PASS', 'FAIL', 'BLOCKED'] as const
const ENVIRONMENTS = ['LOCAL', 'PREVIEW', 'PRODUCTION'] as const
const MAX_FILES = 5
const MAX_BYTES = 10 * 1024 * 1024

interface RecordRunDialogProps {
  testCase: TestCase
  /** 本任务关联的 PR；下拉只列这些，默认不选中。 */
  pullRequests: TaskPullRequestSnapshot[]
  onSubmit: (body: RecordRunBody, files: File[]) => Promise<void> | void
  onClose: () => void
}

const fieldClass =
  'rounded-sm border border-border bg-background px-2 py-1 text-body text-foreground'

/**
 * LUM-801: 记一次执行。
 *
 * 三条刻意的行为，别「顺手优化」掉：
 *  1. environment 初始是空字符串，**没有默认选中值**。这个 feature 的目的就是
 *     逼人明说跑在哪；一个默认值会让所有 run 无差别地记成 LOCAL。
 *  2. 失败定位只在 result === 'FAIL' 时出现。BLOCKED 的语义是「用例根本没跑
 *     起来」，没跑起来就没有「挂在第几步」。
 *  3. 本组件**不发请求**：文件上传与落库由父组件编排（SRP）。
 */
export function RecordRunDialog({
  testCase,
  pullRequests,
  onSubmit,
  onClose,
}: RecordRunDialogProps) {
  const intl = useIntl()
  const [result, setResult] = useState<(typeof RESULTS)[number]>('PASS')
  const [environment, setEnvironment] = useState<
    '' | (typeof ENVIRONMENTS)[number]
  >('')
  const [prNumber, setPrNumber] = useState('')
  const [locator, setLocator] = useState('')
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const locatorOptions = [
    ...testCase.steps.map((text, i) => ({
      value: `STEPS:${i}`,
      label: intl.formatMessage(
        { id: 'testCases.field.failedAt.step' },
        { n: i + 1, text }
      ),
    })),
    ...testCase.verification.map((text, i) => ({
      value: `VERIFICATION:${i}`,
      label: intl.formatMessage(
        { id: 'testCases.field.failedAt.verification' },
        { n: i + 1, text }
      ),
    })),
  ]

  /**
   * 两种违规要分开报，并且带上实际数字。
   *
   * 早先这里把静态提示那句原样当错误文案用：用户选了 6 个文件，看到的是同一
   * 句话出现两次（一灰一红），既不知道违的是「太多」还是「太大」，也不知道
   * 自己的实际值。浏览器补验时抓到的（LUM-801）。
   *
   * 被拒时还必须清空原生 input —— 否则它仍显示「已选择 6 个文件」而组件一个
   * 都没收下，用户以为传上去了，实际会记下一条不带任何证据的 run。
   */
  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    const reject = (message: string) => {
      setError(message)
      setFiles([])
      e.target.value = ''
    }

    if (picked.length > MAX_FILES) {
      reject(
        intl.formatMessage(
          { id: 'testCases.field.evidenceFiles.tooMany' },
          { count: picked.length, max: MAX_FILES }
        )
      )
      return
    }

    const oversized = picked.find(f => f.size > MAX_BYTES)
    if (oversized) {
      reject(
        intl.formatMessage(
          { id: 'testCases.field.evidenceFiles.tooLarge' },
          {
            filename: oversized.name,
            size: (oversized.size / 1024 / 1024).toFixed(1),
            max: MAX_BYTES / 1024 / 1024,
          }
        )
      )
      return
    }

    setError(null)
    setFiles(picked)
  }

  async function submit() {
    if (environment === '') {
      setError(
        intl.formatMessage({ id: 'testCases.field.environment.required' })
      )
      return
    }
    const [phase, index] = locator ? locator.split(':') : [null, null]
    setBusy(true)
    try {
      await onSubmit(
        {
          result,
          environment,
          failedPhase:
            result === 'FAIL' && phase
              ? (phase as 'STEPS' | 'VERIFICATION')
              : null,
          // 下拉的 value 里已经是 0-based（label 才是 1-based）。
          failedIndex:
            result === 'FAIL' && index != null ? Number(index) : null,
          note: note.trim() || null,
          pullRequestNumber: prNumber ? Number(prNumber) : null,
          // web 端不自己编 sha：父组件按所选 PR 快照它当下的 head。
          commitSha: null,
          // 远端工作区状态无从得知 —— 留 null（未知），不填 false 冒充干净。
          commitDirty: null,
          evidence: [],
        },
        files
      )
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='flex flex-col gap-3 rounded-md border border-border px-3 py-3'>
      <p className='text-body-strong text-foreground'>
        {intl.formatMessage({ id: 'testCases.dialog.title' })}
      </p>

      <label className='flex flex-col gap-1 text-body text-muted-foreground'>
        {intl.formatMessage({ id: 'testCases.field.result' })}
        <select
          className={fieldClass}
          value={result}
          onChange={e => setResult(e.target.value as (typeof RESULTS)[number])}
        >
          {RESULTS.map(r => (
            <option key={r} value={r}>
              {intl.formatMessage({ id: `testCases.result.${r}` })}
            </option>
          ))}
        </select>
      </label>

      <label className='flex flex-col gap-1 text-body text-muted-foreground'>
        {intl.formatMessage({ id: 'testCases.field.environment' })}
        <select
          className={fieldClass}
          value={environment}
          onChange={e =>
            setEnvironment(e.target.value as (typeof ENVIRONMENTS)[number] | '')
          }
        >
          <option value=''>
            {intl.formatMessage({
              id: 'testCases.field.environment.placeholder',
            })}
          </option>
          {ENVIRONMENTS.map(env => (
            <option key={env} value={env}>
              {intl.formatMessage({ id: `testCases.env.${env}` })}
            </option>
          ))}
        </select>
      </label>

      <label className='flex flex-col gap-1 text-body text-muted-foreground'>
        {intl.formatMessage({ id: 'testCases.field.pullRequest' })}
        <select
          className={fieldClass}
          value={prNumber}
          onChange={e => setPrNumber(e.target.value)}
        >
          <option value=''>
            {intl.formatMessage({ id: 'testCases.field.pullRequest.none' })}
          </option>
          {pullRequests.map(pr => (
            <option key={pr.id} value={String(pr.number)}>
              #{pr.number} {pr.title}
            </option>
          ))}
        </select>
      </label>

      {result === 'FAIL' ? (
        <label className='flex flex-col gap-1 text-body text-muted-foreground'>
          {intl.formatMessage({ id: 'testCases.field.failedAt' })}
          <select
            className={fieldClass}
            value={locator}
            onChange={e => setLocator(e.target.value)}
          >
            <option value=''>
              {intl.formatMessage({ id: 'testCases.field.failedAt.none' })}
            </option>
            {locatorOptions.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className='flex flex-col gap-1 text-body text-muted-foreground'>
        {intl.formatMessage({ id: 'testCases.field.note' })}
        <textarea
          className={fieldClass}
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={3}
        />
      </label>

      <label className='flex flex-col gap-1 text-body text-muted-foreground'>
        {intl.formatMessage({ id: 'testCases.field.evidenceFiles' })}
        <input
          type='file'
          multiple
          accept='image/png,image/jpeg,image/webp,image/gif,text/plain,application/json'
          onChange={handleFiles}
        />
        <span className='text-[11px] text-muted-foreground'>
          {intl.formatMessage({ id: 'testCases.field.evidenceFiles.hint' })}
        </span>
      </label>

      {error ? <p className='text-body text-destructive'>{error}</p> : null}

      <div className='flex gap-2'>
        <button
          type='button'
          onClick={submit}
          disabled={busy}
          className='rounded-sm border border-foreground px-2 py-1 text-body text-foreground disabled:opacity-50'
        >
          {intl.formatMessage({ id: 'testCases.action.record' })}
        </button>
        <button
          type='button'
          onClick={onClose}
          className='px-2 py-1 text-body text-muted-foreground hover:text-foreground'
        >
          {intl.formatMessage({ id: 'testCases.action.cancel' })}
        </button>
      </div>
    </div>
  )
}
