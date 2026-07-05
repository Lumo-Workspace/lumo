'use client'

import { useCallback } from 'react'
import { useIntl } from 'react-intl'
import { useIdeaFigmaLinks } from '../../hooks/useIdeaFigmaLinks'
import { ContextSection } from '../TaskDetailTimeline/ContextSection'
import { LinkFigmaPopover } from '../LinkFigmaPopover'
import { FigmaLinkCard } from '../TaskDetailTimeline/FigmaLinkCard'
import { FigmaIcon } from '../FigmaIcon'

interface Props {
  ideaId: string
}

/** Idea-scoped mirror of `FigmaSection` (Task variant) — same reused
 * `FigmaLinkCard` + `LinkFigmaPopover` + `ContextSection`, backed by the idea
 * hook instead of the task one. */
export function IdeaFigmaSection({ ideaId }: Props): React.ReactElement {
  const intl = useIntl()
  const { figmaLinks, loading, add, remove, refreshAll } =
    useIdeaFigmaLinks(ideaId)

  const handleAttach = useCallback(
    async (url: string) => {
      await add({ url })
    },
    [add]
  )

  const addSlot = <LinkFigmaPopover onAttach={handleAttach} />

  return (
    <ContextSection
      value='figma'
      label={intl.formatMessage({
        id: 'task.figma.sectionTitle',
        defaultMessage: 'Figma Designs',
      })}
      icon={<FigmaIcon className='w-3.5 h-3.5' />}
      count={figmaLinks.length}
      addSlot={addSlot}
    >
      {loading ? (
        <div className='py-4 text-caption text-muted-foreground text-center'>
          {intl.formatMessage({
            id: 'common.loading',
            defaultMessage: 'Loading…',
          })}
        </div>
      ) : figmaLinks.length === 0 ? (
        <div className='py-4 text-caption text-muted-foreground text-center'>
          {intl.formatMessage({
            id: 'task.figma.empty',
            defaultMessage: 'No Figma designs',
          })}
        </div>
      ) : (
        <div className='space-y-3'>
          {figmaLinks.map(link => (
            <FigmaLinkCard
              key={link.id}
              link={link}
              onRemove={remove}
              onRefreshAll={refreshAll}
            />
          ))}
        </div>
      )}
    </ContextSection>
  )
}
