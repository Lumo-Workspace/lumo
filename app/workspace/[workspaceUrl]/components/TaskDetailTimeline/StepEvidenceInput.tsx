'use client'

import { useIntl } from 'react-intl'
import { Label } from '@/components/ui/label'
import { Paperclip, X } from 'lucide-react'
import { EVIDENCE_ALLOWED_TYPES } from '@/lib/validation/test-case'

interface StepEvidenceInputProps {
  /** 这一步的引用（s2 / v1），只用于无障碍标签。 */
  stepRef: string
  files: File[]
  /** 新选中的文件；收不收（总数 / 大小 / 类型）由父组件判。 */
  onPick: (picked: File[]) => void
  onRemove: (index: number) => void
}

/**
 * LUM-1185: 记录弹窗里一步下面的「挂证据」入口 + 已挂文件列表。
 * 只渲染与转发事件，不判限额（父组件持有整次 run 的合计）。
 */
export function StepEvidenceInput({
  stepRef,
  files,
  onPick,
  onRemove,
}: StepEvidenceInputProps) {
  const intl = useIntl()
  return (
    <div className='flex flex-col gap-1 pl-4' data-testid='step-evidence'>
      <Label className='flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground'>
        <Paperclip className='size-3' aria-hidden />
        <span>
          {intl.formatMessage({ id: 'testCases.field.stepEvidence.add' })}
        </span>
        <input
          type='file'
          multiple
          className='sr-only'
          accept={EVIDENCE_ALLOWED_TYPES.join(',')}
          aria-label={intl.formatMessage(
            { id: 'testCases.field.stepEvidence.addLabel' },
            { step: stepRef }
          )}
          onChange={e => {
            const picked = Array.from(e.target.files ?? [])
            // 允许再次选同一个文件：清空原生 input，列表由父组件持有。
            e.target.value = ''
            if (picked.length > 0) onPick(picked)
          }}
        />
      </Label>
      {files.length > 0 ? (
        <ul className='flex flex-col gap-0.5 text-caption text-foreground'>
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className='flex items-center gap-1'>
              <span className='truncate'>{f.name}</span>
              <button
                type='button'
                className='text-muted-foreground hover:text-foreground'
                aria-label={intl.formatMessage(
                  { id: 'testCases.field.stepEvidence.remove' },
                  { filename: f.name }
                )}
                onClick={() => onRemove(i)}
              >
                <X className='size-3' aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
