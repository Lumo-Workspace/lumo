'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFeishuImportAvailable } from '../../hooks/useFeishuImportAvailable'
import { FeishuImportDialog } from './FeishuImportDialog'

/**
 * LUM-1343 — the documents page's "Import from Feishu" button and dialog.
 * Renders nothing unless the member's Feishu account is linked.
 */
export function FeishuImportAction({
  onImported,
}: {
  onImported: (slug: string) => void
}) {
  const intl = useIntl()
  const available = useFeishuImportAvailable()
  const [open, setOpen] = useState(false)
  if (!available) return null
  return (
    <>
      <Button
        size='sm'
        variant='outline'
        className='gap-1.5'
        onClick={() => setOpen(true)}
      >
        <Download size={14} />
        {intl.formatMessage({ id: 'documents.importFromFeishu' })}
      </Button>
      <FeishuImportDialog
        open={open}
        onOpenChange={setOpen}
        onImported={onImported}
      />
    </>
  )
}
