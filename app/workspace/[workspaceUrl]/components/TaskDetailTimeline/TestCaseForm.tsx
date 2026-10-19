'use client'

import { useId, useState } from 'react'
import { useIntl } from 'react-intl'
import type { TestCase } from '@prisma/client'
import type { CreateTestCaseBody } from '@/lib/validation/test-case'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface TestCaseFormProps {
  /** 存在即编辑模式。 */
  initial?: TestCase | undefined
  onSubmit: (body: CreateTestCaseBody) => Promise<void> | void
  onCancel: () => void
}

const fieldClass =
  'rounded-sm border border-border bg-background px-2 py-1 text-body text-foreground'

/** Radix Select can't hold an item with value "" — "any environment" maps to this. */
const ANY_ENV = 'ANY'

/** 一段有序的动态列表（增 / 删 / 上移 / 下移）。 */
function StepList({
  label,
  items,
  onChange,
  addLabel,
}: {
  label: string
  items: string[]
  onChange: (next: string[]) => void
  addLabel: string
}) {
  const intl = useIntl()
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved!)
    onChange(next)
  }
  return (
    <div className='flex flex-col gap-1'>
      <span className='text-body text-muted-foreground'>{label}</span>
      {items.map((value, i) => (
        <div key={i} className='flex items-center gap-1'>
          <span className='w-4 tabular-nums text-caption text-muted-foreground/70'>
            {i + 1}
          </span>
          <input
            className={`${fieldClass} flex-1`}
            value={value}
            onChange={e => {
              const next = [...items]
              next[i] = e.target.value
              onChange(next)
            }}
            // 预填值获得焦点时把光标放到末尾，而不是整段选中——整段选中时第一次
            // 按键会抹掉全部内容（LUM-711）。jsdom 不复现，只能在真浏览器里验。
            onFocus={e =>
              e.currentTarget.setSelectionRange(
                e.currentTarget.value.length,
                e.currentTarget.value.length
              )
            }
          />
          <button
            type='button'
            aria-label={intl.formatMessage({ id: 'testCases.form.moveUp' })}
            onClick={() => move(i, i - 1)}
            className='px-1 text-caption text-muted-foreground hover:text-foreground'
          >
            ↑
          </button>
          <button
            type='button'
            aria-label={intl.formatMessage({ id: 'testCases.form.moveDown' })}
            onClick={() => move(i, i + 1)}
            className='px-1 text-caption text-muted-foreground hover:text-foreground'
          >
            ↓
          </button>
          <button
            type='button'
            aria-label={intl.formatMessage({ id: 'testCases.form.removeStep' })}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className='px-1 text-caption text-muted-foreground hover:text-foreground'
          >
            ×
          </button>
        </div>
      ))}
      <button
        type='button'
        onClick={() => onChange([...items, ''])}
        className='self-start text-caption text-muted-foreground hover:text-foreground'
      >
        + {addLabel}
      </button>
    </div>
  )
}

/**
 * LUM-801: 新建 / 编辑一条 test case。
 *
 * 本组件**不发请求**——提交交给 `onSubmit`（SRP：表单管收集，编排在
 * TestCasesSection）。
 */
export function TestCaseForm({
  initial,
  onSubmit,
  onCancel,
}: TestCaseFormProps) {
  const intl = useIntl()
  const fieldId = useId()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [setup, setSetup] = useState(initial?.setup ?? '')
  const [steps, setSteps] = useState<string[]>(initial?.steps ?? [''])
  const [verification, setVerification] = useState<string[]>(
    initial?.verification ?? []
  )
  const [expected, setExpected] = useState(initial?.expected ?? '')
  // LUM-808: 这条用例只有在该环境跑才证明得了东西。空 = 不限（合法默认）。
  const [requiredEnvironment, setRequiredEnvironment] = useState<
    '' | 'LOCAL' | 'PREVIEW' | 'PRODUCTION'
  >(initial?.requiredEnvironment ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const cleanSteps = steps.map(s => s.trim()).filter(Boolean)
    const cleanVerification = verification.map(s => s.trim()).filter(Boolean)
    if (!title.trim()) {
      setError(intl.formatMessage({ id: 'testCases.form.titleRequired' }))
      return
    }
    if (cleanSteps.length === 0) {
      setError(intl.formatMessage({ id: 'testCases.form.stepsRequired' }))
      return
    }
    if (!expected.trim()) {
      setError(intl.formatMessage({ id: 'testCases.form.expectedRequired' }))
      return
    }
    setBusy(true)
    try {
      await onSubmit({
        title: title.trim(),
        setup: setup.trim() || null,
        steps: cleanSteps,
        verification: cleanVerification,
        expected: expected.trim(),
        requiredEnvironment: requiredEnvironment || null,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='flex flex-col gap-3 rounded-md border border-border px-3 py-3'>
      <label className='flex flex-col gap-1 text-body text-muted-foreground'>
        {intl.formatMessage({ id: 'testCases.form.title' })}
        <input
          className={fieldClass}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onFocus={e =>
            e.currentTarget.setSelectionRange(
              e.currentTarget.value.length,
              e.currentTarget.value.length
            )
          }
        />
      </label>

      <label className='flex flex-col gap-1 text-body text-muted-foreground'>
        {intl.formatMessage({ id: 'testCases.form.setup' })}
        <textarea
          className={fieldClass}
          rows={2}
          value={setup}
          onChange={e => setSetup(e.target.value)}
        />
      </label>

      <StepList
        label={intl.formatMessage({ id: 'testCases.form.steps' })}
        items={steps}
        onChange={setSteps}
        addLabel={intl.formatMessage({ id: 'testCases.form.addStep' })}
      />

      <StepList
        label={intl.formatMessage({ id: 'testCases.form.verification' })}
        items={verification}
        onChange={setVerification}
        addLabel={intl.formatMessage({ id: 'testCases.form.addStep' })}
      />

      <label className='flex flex-col gap-1 text-body text-muted-foreground'>
        {intl.formatMessage({ id: 'testCases.form.expected' })}
        <textarea
          className={fieldClass}
          rows={2}
          value={expected}
          onChange={e => setExpected(e.target.value)}
        />
      </label>

      <div className='flex flex-col gap-1 text-body text-muted-foreground'>
        <label htmlFor={`${fieldId}-requires-env`}>
          {intl.formatMessage({ id: 'testCases.form.requiresEnv' })}
        </label>
        <Select
          value={requiredEnvironment || ANY_ENV}
          onValueChange={v =>
            setRequiredEnvironment(
              v === ANY_ENV ? '' : (v as 'LOCAL' | 'PREVIEW' | 'PRODUCTION')
            )
          }
        >
          <SelectTrigger
            id={`${fieldId}-requires-env`}
            className='text-foreground'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_ENV}>
              {intl.formatMessage({ id: 'testCases.form.requiresEnv.any' })}
            </SelectItem>
            {(['LOCAL', 'PREVIEW', 'PRODUCTION'] as const).map(env => (
              <SelectItem key={env} value={env}>
                {intl.formatMessage({ id: `testCases.env.${env}` })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className='text-caption'>
          {intl.formatMessage({ id: 'testCases.form.requiresEnv.hint' })}
        </span>
      </div>

      {error ? <p className='text-body text-danger-text'>{error}</p> : null}

      <div className='flex gap-2'>
        <button
          type='button'
          onClick={submit}
          disabled={busy}
          className='rounded-sm border border-foreground px-2 py-1 text-body text-foreground disabled:opacity-50'
        >
          {intl.formatMessage({
            id: initial ? 'testCases.action.save' : 'testCases.action.create',
          })}
        </button>
        <button
          type='button'
          onClick={onCancel}
          className='px-2 py-1 text-body text-muted-foreground hover:text-foreground'
        >
          {intl.formatMessage({ id: 'testCases.action.cancel' })}
        </button>
      </div>
    </div>
  )
}
