'use client'

import { useCallback } from 'react'
import { useIntl } from 'react-intl'
import { useFigmaLinks } from '../../../hooks/useFigmaLinks'
import { ContextSection } from '../ContextSection'
import { LinkFigmaPopover } from '../../LinkFigmaPopover'
import { FigmaLinkCard } from '../FigmaLinkCard'
import { FigmaIcon } from '../../FigmaIcon'

interface Props {
  taskId: string
}

export function FigmaSection({ taskId }: Props): React.ReactElement {
  const intl = useIntl()
  const { figmaLinks, loading, add, remove, refreshAll } = useFigmaLinks(taskId)

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
        <div className='py-4 text-xs text-zinc-400 dark:text-zinc-500 text-center'>
          {intl.formatMessage({
            id: 'common.loading',
            defaultMessage: 'Loading…',
          })}
        </div>
      ) : figmaLinks.length === 0 ? (
        <div className='py-4 text-xs text-zinc-400 dark:text-zinc-500 text-center'>
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
