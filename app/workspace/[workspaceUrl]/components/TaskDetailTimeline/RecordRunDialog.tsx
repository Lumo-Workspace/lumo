'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import type { TestCase } from '@prisma/client'
import type { RecordRunBody } from '@/lib/validation/test-case'
import type { TaskPullRequestSnapshot } from '@/lib/test-cases/freshness'
import {
  pickerToStepResults,
  type PickerState,
} from '@/lib/test-cases/step-picker'
import { StepResultPicker } from './StepResultPicker'

const RESULTS = ['PASS', 'FAIL', 'BLOCKED'] as const
const CAUSES = [
  'IMPLEMENTATION_DEFECT',
  'CASE_OUTDATED',
  'EXTERNAL_BLOCK',
  'UNKNOWN',
] as const
const ENVIRONMENTS = ['LOCAL', 'PREVIEW', 'PRODUCTION'] as const
const MAX_FILES = 5
const MAX_BYTES = 10 * 1024 * 1024

interface RecordRunDialogProps {
  testCase: TestCase
  /** 本任务关联的 PR；下拉只列这些，默认不选中。 */
  pullRequests: TaskPullRequestSnapshot[]
  /** LUM-1135: 里程碑的 run 不挂 PR，owner 为里程碑时关掉 PR 下拉。 */
  showPullRequests?: boolean
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
 *  2. 失败点由逐步选择器里标「失败」的那一步决定；BLOCKED 不显示选择器
 *     （用例根本没跑起来，没有「挂在第几步」）。
 *  3. 本组件**不发请求**：文件上传与落库由父组件编排（SRP）。
 */
export function RecordRunDialog({
  testCase,
  pullRequests,
  showPullRequests = true,
  onSubmit,
  onClose,
}: RecordRunDialogProps) {
  const intl = useIntl()
  const [result, setResult] = useState<(typeof RESULTS)[number]>('PASS')
  const [environment, setEnvironment] = useState<
    '' | (typeof ENVIRONMENTS)[number]
  >('')
  const [prNumber, setPrNumber] = useState('')
  // LUM-808: 没有默认选中值，同 environment —— 归因也是要人明说的东西。
  const [cause, setCause] = useState<'' | (typeof CAUSES)[number]>('')
  const [note, setNote] = useState('')
  // LUM-1011: what the person actually saw at the failing step.
  const [actual, setActual] = useState('')
  // LUM-1211: 每一步的结果；服务端拒收没报全的 run。
  const [picked, setPicked] = useState<PickerState>({})
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
    if (result === 'FAIL' && cause === '') {
      setError(intl.formatMessage({ id: 'testCases.field.cause.required' }))
      return
    }
    if (
      result === 'FAIL' &&
      cause === 'IMPLEMENTATION_DEFECT' &&
      files.length === 0
    ) {
      setError(
        intl.formatMessage({ id: 'testCases.field.cause.needsEvidence' })
      )
      return
    }
    let stepResults: ReturnType<typeof pickerToStepResults> | null = null
    if (
      result !== 'BLOCKED' &&
      testCase.steps.length + testCase.verification.length > 0
    ) {
      stepResults = pickerToStepResults(
        testCase.steps,
        testCase.verification,
        result,
        picked
      )
      if (!stepResults.ok) {
        setError(
          stepResults.missing.length > 0
            ? intl.formatMessage(
                { id: 'testCases.field.stepResults.missing' },
                { refs: stepResults.missing.join(', ') }
              )
            : intl.formatMessage({
                id: 'testCases.field.stepResults.noFailure',
              })
        )
        return
      }
    }
    setBusy(true)
    try {
      await onSubmit(
        {
          result,
          environment,
          // 失败点由 stepResults 里的 FAIL 条目给出，服务端补齐定位。
          failedPhase: null,
          failedIndex: null,
          failureAttribution: result === 'FAIL' ? cause || null : null,
          unprovenVerification: [],
          ...(stepResults?.ok ? { stepResults: stepResults.value } : {}),
          actual: result === 'FAIL' ? actual.trim() || null : null,
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

      {showPullRequests ? (
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
      ) : null}

      {result !== 'BLOCKED' &&
      testCase.steps.length + testCase.verification.length > 0 ? (
        <StepResultPicker
          steps={testCase.steps}
          verification={testCase.verification}
          result={result}
          value={picked}
          onChange={setPicked}
        />
      ) : null}

      {result === 'FAIL' ? (
        <label className='flex flex-col gap-1 text-body text-muted-foreground'>
          {intl.formatMessage({ id: 'testCases.field.cause' })}
          <select
            className={fieldClass}
            value={cause}
            onChange={e =>
              setCause(e.target.value as '' | (typeof CAUSES)[number])
            }
          >
            <option value=''>
              {intl.formatMessage({ id: 'testCases.field.cause.placeholder' })}
            </option>
            {CAUSES.map(c => (
              <option key={c} value={c}>
                {intl.formatMessage({ id: `testCases.cause.${c}` })}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {result === 'FAIL' ? (
        <label className='flex flex-col gap-1 text-body text-muted-foreground'>
          {intl.formatMessage({ id: 'testCases.field.actual' })}
          <textarea
            className={fieldClass}
            value={actual}
            onChange={e => setActual(e.target.value)}
            placeholder={intl.formatMessage({
              id: 'testCases.field.actual.placeholder',
            })}
            rows={2}
          />
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

      {error ? <p className='text-body text-danger-text'>{error}</p> : null}

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
