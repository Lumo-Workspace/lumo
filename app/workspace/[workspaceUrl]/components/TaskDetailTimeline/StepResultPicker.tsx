'use client'

import { useIntl } from 'react-intl'
import type { PickerState } from '@/lib/test-cases/step-picker'

interface StepResultPickerProps {
  steps: string[]
  verification: string[]
  result: 'PASS' | 'FAIL'
  value: PickerState
  onChange: (next: PickerState) => void
}

const fieldClass =
  'rounded-sm border border-border bg-background px-2 py-1 text-body text-foreground'

/** LUM-1211: 每一步一行：通过 / 失败（仅 FAIL）/ 跳过（附原因）。只渲染，不判完整性。 */
export function StepResultPicker({
  steps,
  verification,
  result,
  value,
  onChange,
}: StepResultPickerProps) {
  const intl = useIntl()
  const items = [
    ...steps.map((text, index) => ({
      key: `STEPS:${index}`,
      label: `${index + 1}. ${text}`,
    })),
    ...verification.map((text, index) => ({
      key: `VERIFICATION:${index}`,
      label: intl.formatMessage(
        { id: 'testCases.field.failedAt.verification' },
        { n: index + 1, text }
      ),
    })),
  ]
  const statuses =
    result === 'FAIL'
      ? (['PASS', 'FAIL', 'SKIP'] as const)
      : (['PASS', 'SKIP'] as const)
  const set = (key: string, status: 'PASS' | 'FAIL' | 'SKIP') =>
    onChange({ ...value, [key]: { status, reason: value[key]?.reason ?? '' } })

  return (
    <fieldset className='flex flex-col gap-2 text-body text-muted-foreground'>
      <legend>
        {intl.formatMessage({ id: 'testCases.field.stepResults' })}
      </legend>
      <p className='text-[11px]'>
        {intl.formatMessage({ id: 'testCases.field.stepResults.hint' })}
      </p>
      {items.map(item => {
        const entry = value[item.key]
        return (
          <div key={item.key} className='flex flex-col gap-1'>
            <span className='text-foreground'>{item.label}</span>
            <div className='flex gap-3'>
              {statuses.map(s => (
                <label key={s} className='flex items-center gap-1'>
                  <input
                    type='radio'
                    name={item.key}
                    checked={entry?.status === s}
                    onChange={() => set(item.key, s)}
                  />
                  {intl.formatMessage({
                    id: `testCases.field.stepResults.${s.toLowerCase()}`,
                  })}
                </label>
              ))}
            </div>
            {entry?.status === 'SKIP' ? (
              <input
                className={fieldClass}
                maxLength={200}
                value={entry.reason}
                placeholder={intl.formatMessage({
                  id: 'testCases.field.stepResults.reason',
                })}
                onChange={e =>
                  onChange({
                    ...value,
                    [item.key]: { status: 'SKIP', reason: e.target.value },
                  })
                }
              />
            ) : null}
          </div>
        )
      })}
      <button
        type='button'
        className='self-start px-2 py-1 text-body text-muted-foreground hover:text-foreground'
        onClick={() => {
          const next = { ...value }
          for (const item of items)
            next[item.key] ??= { status: 'PASS', reason: '' }
          onChange(next)
        }}
      >
        {intl.formatMessage({ id: 'testCases.field.stepResults.restPass' })}
      </button>
    </fieldset>
  )
}
