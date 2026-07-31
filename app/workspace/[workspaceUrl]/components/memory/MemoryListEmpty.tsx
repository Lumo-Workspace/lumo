'use client'

import { useIntl } from 'react-intl'
import { Brain, Plus, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

interface MemoryListEmptyProps {
  /**
   * `none` = the project has no memories at all. `noResults` = it has some,
   * but the search / category chip hides them all. Different reasons, so
   * different copy and a different way out.
   */
  variant: 'none' | 'noResults'
  onCreate: () => void
  onClearFilters: () => void
}

/**
 * The memory list with nothing to show.
 *
 * The two variants exist because "you haven't captured anything yet" and "your
 * filter matches nothing" are different facts about the project, and a single
 * "No memories yet" tells a reader who just typed a query something false. The
 * way out differs too: create the first memory vs. drop the filter — offering
 * "New memory" to someone whose search missed would answer a question they
 * didn't ask.
 */
export function MemoryListEmpty({
  variant,
  onCreate,
  onClearFilters,
}: MemoryListEmptyProps) {
  const intl = useIntl()
  const noResults = variant === 'noResults'

  return (
    <div
      className='overflow-hidden rounded-lg border border-border'
      data-testid={`memory-empty-${variant}`}
    >
      {/* The `md:` padding has to be restated: Empty's own `md:p-12` beats an
          unprefixed override at the widths a project tab is read at. */}
      <Empty className='gap-4 px-5 py-14 md:px-5 md:py-14'>
        <EmptyHeader className='gap-2'>
          <EmptyMedia variant='icon'>
            {noResults ? <SearchX /> : <Brain />}
          </EmptyMedia>
          {/* `font-semibold` is not redundant with the token: EmptyTitle's own
              `font-medium` survives the merge and would otherwise win. */}
          <EmptyTitle className='text-body-strong font-semibold'>
            {intl.formatMessage({
              id: noResults
                ? 'memory.list.empty.noResults.title'
                : 'memory.tab.empty.title',
            })}
          </EmptyTitle>
          <EmptyDescription>
            {intl.formatMessage({
              id: noResults
                ? 'memory.list.empty.noResults.body'
                : 'memory.tab.empty.description',
            })}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {noResults ? (
            <Button variant='outline' onClick={onClearFilters}>
              {intl.formatMessage({ id: 'memory.list.empty.clear' })}
            </Button>
          ) : (
            <Button onClick={onCreate}>
              <Plus className='size-4' aria-hidden />
              {intl.formatMessage({ id: 'memory.action.add' })}
            </Button>
          )}
        </EmptyContent>
      </Empty>
    </div>
  )
}
