'use client'

import { useCallback } from 'react'
import { useIntl } from 'react-intl'
import { Link } from 'lucide-react'
import { useIdeaWebLinks } from '../../hooks/useIdeaWebLinks'
import { ContextSection } from '../TaskDetailTimeline/ContextSection'
import { LinkWebLinkPopover } from '../LinkWebLinkPopover'
import { WebLinkCard } from '../TaskDetailTimeline/WebLinkCard'

interface Props {
  ideaId: string
}

/** Idea-scoped mirror of `WebLinkSection` (Task variant) — same reused
 * `WebLinkCard` + `LinkWebLinkPopover` + `ContextSection`, backed by the idea
 * hook instead of the task one. */
export function IdeaWebLinkSection({ ideaId }: Props): React.ReactElement {
  const intl = useIntl()
  const { webLinks, loading, add, remove, refreshOne } = useIdeaWebLinks(ideaId)

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
      {loading ? (
        <div className='py-4 text-caption text-muted-foreground text-center'>
          {intl.formatMessage({
            id: 'common.loading',
            defaultMessage: 'Loading…',
          })}
        </div>
      ) : webLinks.length === 0 ? (
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
    </ContextSection>
  )
}
