'use client'

import { useIntl } from 'react-intl'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface PickerTemplate {
  id: string
  key: string
  emoji: string | null
  content: string
}

interface DocumentTemplatePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  templates: PickerTemplate[]
  loading: boolean
  /** null = blank document; otherwise the chosen template. */
  onSelect: (template: PickerTemplate | null) => void
}

/** Map a kebab-case template key to its camelCase i18n suffix. */
function intlKey(key: string): string {
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

export function DocumentTemplatePicker({
  open,
  onOpenChange,
  templates,
  loading,
  onSelect,
}: DocumentTemplatePickerProps) {
  const intl = useIntl()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: 'documents.selectTemplate' })}
          </DialogTitle>
        </DialogHeader>

        <div className='grid grid-cols-2 gap-3'>
          <button
            type='button'
            onClick={() => onSelect(null)}
            className='flex flex-col items-start gap-1 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent'
          >
            <span className='text-2xl'>📄</span>
            <span className='font-medium text-foreground'>
              {intl.formatMessage({ id: 'documents.templateBlank' })}
            </span>
            <span className='text-sm text-muted-foreground'>
              {intl.formatMessage({ id: 'documents.templateBlankDesc' })}
            </span>
          </button>

          {!loading &&
            templates.map(t => {
              const k = intlKey(t.key)
              return (
                <button
                  key={t.id}
                  type='button'
                  onClick={() => onSelect(t)}
                  className='flex flex-col items-start gap-1 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent'
                >
                  <span className='text-2xl'>{t.emoji ?? '📄'}</span>
                  <span className='font-medium text-foreground'>
                    {intl.formatMessage({ id: `documents.template.${k}` })}
                  </span>
                  <span className='text-sm text-muted-foreground'>
                    {intl.formatMessage({ id: `documents.template.${k}Desc` })}
                  </span>
                </button>
              )
            })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
