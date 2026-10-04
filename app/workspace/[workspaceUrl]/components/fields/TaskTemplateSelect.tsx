'use client'

import { useIntl } from 'react-intl'
import { FileText } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import type { TaskTemplateItem } from '@/lib/api-client'

const NONE = '__none__'

export interface TaskTemplateSelectProps {
  templates: TaskTemplateItem[]
  /** Key of the applied template, or null for none. */
  value: string | null
  onChange: (template: TaskTemplateItem | null) => void
  triggerClassName?: string
}

/**
 * LUM-970: pick a task template in the new-task form. Pure picker — the
 * caller decides what applying a template does to the description.
 */
export function TaskTemplateSelect({
  templates,
  value,
  onChange,
  triggerClassName,
}: TaskTemplateSelectProps) {
  const intl = useIntl()
  const selected = templates.find(t => t.key === value)
  const noneLabel = intl.formatMessage({ id: 'taskTemplate.none' })

  return (
    <Select
      value={selected ? selected.key : NONE}
      onValueChange={v =>
        onChange(v === NONE ? null : (templates.find(t => t.key === v) ?? null))
      }
    >
      <SelectTrigger
        className={triggerClassName}
        aria-label={intl.formatMessage({ id: 'taskTemplate.label' })}
      >
        <FileText className='size-3.5 text-muted-foreground' />
        {selected ? (
          <span>{selected.name}</span>
        ) : (
          <span className='text-muted-foreground'>
            {intl.formatMessage({ id: 'taskTemplate.label' })}
          </span>
        )}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {templates.map(t => (
          <SelectItem key={t.key} value={t.key}>
            <span className='flex flex-col'>
              <span>{t.name}</span>
              {t.description && (
                <span className='text-xs text-muted-foreground'>
                  {t.description}
                </span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
