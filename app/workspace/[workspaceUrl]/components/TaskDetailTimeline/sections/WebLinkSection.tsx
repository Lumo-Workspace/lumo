'use client'

import { useCallback } from 'react'
import { useIntl } from 'react-intl'
import { Link } from 'lucide-react'
import { useWebLinks } from '../../../hooks/useWebLinks'
import { ContextSection } from '../ContextSection'
import { LinkWebLinkPopover } from '../../LinkWebLinkPopover'
import { WebLinkCard } from '../WebLinkCard'
import { AsyncContent } from '../../AsyncContent'
import { RowListSkeleton } from '../../skeletons/RowListSkeleton'

interface Props {
  taskId: string
}

export function WebLinkSection({ taskId }: Props): React.ReactElement {
  const intl = useIntl()
  const { webLinks, loading, add, remove, refreshOne } = useWebLinks(taskId)

  const handleAttach = useCallback(
    async (url: string) => {
      await add({ url })
    },
    [add]
  )

  const addSlot = <LinkWebLinkPopover onAttach={handleAttach} />

  return (
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
      <AsyncContent
        loading={loading}
        loadingState={
          <RowListSkeleton
            rows={2}
            leading='icon'
            subtitle
            trailing={false}
            rowClassName='rounded-lg border border-border p-3'
            className='space-y-3'
          />
        }
      >
        {webLinks.length === 0 ? (
          <div className='py-4 text-caption text-muted-foreground text-center'>
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
      </AsyncContent>
    </ContextSection>
  )
}
