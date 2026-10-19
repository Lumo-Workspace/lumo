'use client'

import { useIntl } from 'react-intl'
import { Card } from '@/components/ui/card'
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
          <Card
            asChild
            className='flex flex-col items-start gap-1 p-4 text-left transition-colors hover:bg-accent'
          >
            <button type='button' onClick={() => onSelect(null)}>
              <span className='text-heading'>📄</span>
              <span className='text-body-strong text-foreground'>
                {intl.formatMessage({ id: 'documents.templateBlank' })}
              </span>
              <span className='text-body text-muted-foreground'>
                {intl.formatMessage({ id: 'documents.templateBlankDesc' })}
              </span>
            </button>
          </Card>

          {!loading &&
            templates.map(t => {
              const k = intlKey(t.key)
              return (
                <Card
                  key={t.id}
                  asChild
                  className='flex flex-col items-start gap-1 p-4 text-left transition-colors hover:bg-accent'
                >
                  <button type='button' onClick={() => onSelect(t)}>
                    <span className='text-heading'>{t.emoji ?? '📄'}</span>
                    <span className='text-body-strong text-foreground'>
                      {intl.formatMessage({ id: `documents.template.${k}` })}
                    </span>
                    <span className='text-body text-muted-foreground'>
                      {intl.formatMessage({
                        id: `documents.template.${k}Desc`,
                      })}
                    </span>
                  </button>
                </Card>
              )
            })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
