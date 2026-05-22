'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Link } from 'lucide-react'
import { useWebLinks } from '../../../hooks/useWebLinks'
import { ContextSection } from '../ContextSection'
import { SectionAddButton } from '../SectionAddButton'
import { WebLinkAddDialog } from '../WebLinkAddDialog'
import { WebLinkCard } from '../WebLinkCard'

interface Props {
  taskId: string
}

export function WebLinkSection({ taskId }: Props): React.ReactElement {
  const intl = useIntl()
  const [dialogOpen, setDialogOpen] = useState(false)
  const { webLinks, loading, add, remove, refreshOne } = useWebLinks(taskId)

  const addSlot = (
    <SectionAddButton
      onClick={() => setDialogOpen(true)}
      label={intl.formatMessage({
        id: 'task.webLinks.addButton',
        defaultMessage: 'Add web link',
      })}
    />
  )

  return (
    <>
      <ContextSection
        value='webLinks'
        label={intl.formatMessage({
          id: 'task.webLinks.sectionTitle',
          defaultMessage: 'Web Links',
        })}
        icon={<Link size={14} />}
        count={webLinks.length}
        addSlot={addSlot}
      >
        {loading ? (
          <div className='py-4 text-xs text-zinc-400 dark:text-zinc-500 text-center'>
            {intl.formatMessage({
              id: 'common.loading',
              defaultMessage: 'Loading…',
            })}
          </div>
        ) : webLinks.length === 0 ? (
          <div className='py-4 text-xs text-zinc-400 dark:text-zinc-500 text-center'>
            {intl.formatMessage({
              id: 'task.webLinks.empty',
              defaultMessage: 'No web links',
            })}
          </div>
        ) : (
          <div className='space-y-3'>
            {webLinks.map(link => (
              <WebLinkCard
                key={link.id}
                link={link}
                onRefresh={refreshOne}
                onRemove={remove}
              />
            ))}
          </div>
        )}
      </ContextSection>

      <WebLinkAddDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={payload => add(payload)}
      />
    </>
  )
}
