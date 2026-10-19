'use client'

import { useId, type ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { PickerEntry, PickerState } from '@/lib/test-cases/step-picker'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

interface StepResultPickerProps {
  steps: string[]
  verification: string[]
  result: 'PASS' | 'FAIL'
  value: PickerState
  onChange: (next: PickerState) => void
  /**
   * LUM-1185: 已标结果的步骤下面额外渲染的内容（记录弹窗用它放按步证据）。
   * 没标结果的步骤不调用——证据只能挂在上报的步骤上。
   */
  renderMarkedStep?: (key: string, entry: PickerEntry) => ReactNode
}

/** LUM-1211: 每一步一行：通过 / 失败（仅 FAIL）/ 跳过（附原因）。只渲染，不判完整性。 */
export function StepResultPicker({
  steps,
  verification,
  result,
  value,
  onChange,
  renderMarkedStep,
}: StepResultPickerProps) {
  const intl = useIntl()
  // LUM-1185: 每组单选的 id 按实例加前缀。裸用 `STEPS:0` 时，同一页面上的两个
  // 选择器会互相串组，后渲染的那个把前一个的选中状态抢走。
  const groupId = useId()
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
  // LUM-1185: 撤回一步的结果，回到「未标」。
  const clear = (key: string) => {
    const next = { ...value }
    delete next[key]
    onChange(next)
  }

  return (
    <fieldset className='flex flex-col gap-2 text-body text-muted-foreground'>
      <legend>
        {intl.formatMessage({ id: 'testCases.field.stepResults' })}
      </legend>
      <p className='text-caption'>
        {intl.formatMessage({ id: 'testCases.field.stepResults.hint' })}
      </p>
      {items.map(item => {
        // LUM-1185: 当前结果下不能选的状态（PASS 模式里遗留的 FAIL）在 UI 上
        // 没有对应的单选框，按「未标」显示——不出「清除」，也不出上传入口。
        const raw = value[item.key]
        const entry =
          raw && (statuses as readonly string[]).includes(raw.status)
            ? raw
            : undefined
        return (
          <div key={item.key} className='flex flex-col gap-1'>
            <span className='text-foreground'>{item.label}</span>
            <div className='flex items-center gap-3'>
              <RadioGroup
                className='flex gap-3'
                aria-label={item.label}
                value={entry?.status ?? ''}
                onValueChange={next =>
                  set(item.key, next as (typeof statuses)[number])
                }
              >
                {statuses.map(s => {
                  const id = `${groupId}-${item.key}-${s}`
                  return (
                    <div key={s} className='flex items-center gap-1'>
                      <RadioGroupItem id={id} value={s} />
                      <Label htmlFor={id} className='text-body'>
                        {intl.formatMessage({
                          id: `testCases.field.stepResults.${s.toLowerCase()}`,
                        })}
                      </Label>
                    </div>
                  )
                })}
              </RadioGroup>
              {entry ? (
                <Button
                  type='button'
                  variant='link'
                  className='h-auto p-0 font-normal text-muted-foreground'
                  aria-label={intl.formatMessage(
                    { id: 'testCases.field.stepResults.clearLabel' },
                    { label: item.label }
                  )}
                  onClick={() => clear(item.key)}
                >
                  {intl.formatMessage({
                    id: 'testCases.field.stepResults.clear',
                  })}
                </Button>
              ) : null}
            </div>
            {entry?.status === 'SKIP' ? (
              <Input
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
            {entry && renderMarkedStep
              ? renderMarkedStep(item.key, entry)
              : null}
          </div>
        )
      })}
      <Button
        type='button'
        variant='ghost'
        size='sm'
        className='self-start text-muted-foreground'
        onClick={() => {
          const next = { ...value }
          for (const item of items)
            next[item.key] ??= { status: 'PASS', reason: '' }
          onChange(next)
        }}
      >
        {intl.formatMessage({ id: 'testCases.field.stepResults.restPass' })}
      </Button>
    </fieldset>
  )
}
