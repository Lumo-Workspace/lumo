'use client'

import { useIntl } from 'react-intl'
import {
  Archive,
  ArchiveRestore,
  Link2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface MilestoneActionsMenuProps {
  archived: boolean
  disabled: boolean
  onEdit?: () => void
  onArchiveToggle: () => void
  /** Omitted where the current URL already is the milestone (detail header). */
  onCopyLink?: () => void
  onDelete: () => void
}

/**
 * Kebab menu collapsing the milestone edit / archive / delete actions that
 * used to sit as three inline buttons in the breadcrumb bar. Mirrors the
 * sprint detail page's SprintActionsMenu for cross-page consistency. Pure
 * presentation — the page owns the mutations and edit-dialog state.
 */
export function MilestoneActionsMenu({
  archived,
  disabled,
  onEdit,
  onArchiveToggle,
  onCopyLink,
  onDelete,
}: MilestoneActionsMenuProps) {
  const intl = useIntl()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          className='size-7 text-muted-foreground'
          aria-label={intl.formatMessage({ id: 'milestone.openActions' })}
        >
          <MoreHorizontal className='size-4' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {!archived && onEdit ? (
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className='size-4 mr-2' />
            {intl.formatMessage({ id: 'milestone.edit' })}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem disabled={disabled} onSelect={onArchiveToggle}>
          {archived ? (
            <ArchiveRestore className='size-4 mr-2' />
          ) : (
            <Archive className='size-4 mr-2' />
          )}
          {intl.formatMessage({
            id: archived ? 'milestone.unarchive' : 'milestone.archive',
          })}
        </DropdownMenuItem>
        {onCopyLink ? (
          <DropdownMenuItem onSelect={onCopyLink}>
            <Link2 className='size-4 mr-2' />
            {intl.formatMessage({ id: 'common.copyLink' })}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={disabled}
          className='text-destructive focus:text-destructive'
          onSelect={onDelete}
        >
          <Trash2 className='size-4 mr-2' />
          {intl.formatMessage({ id: 'milestone.delete' })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
