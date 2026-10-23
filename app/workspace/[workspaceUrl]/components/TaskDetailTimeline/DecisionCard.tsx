'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DECISION_INLINE_CLASS,
  renderDecisionInline,
} from '@/lib/task-templates/decision-inline'
import { MemberAvatar } from '@/components/MemberAvatar'
import { DecisionForm } from './DecisionForm'
import type { DecisionInput } from '../../hooks/useTaskDecisions'

interface DecisionCardProps {
  number: number
  text: string
  rationale: string | null
  createdAt: string
  /**
   * Who recorded it — a CLI write is the member whose API key ran it; null
   * when unknown (decisions moved over from a description).
   */
  author: { name: string; imageUrl: string | null } | null
  onEdit: (input: DecisionInput) => Promise<unknown>
  onDelete: () => Promise<unknown>
}

/**
 * LUM-1303: one decision as a card — "Decision N", the ruling, its optional
 * "Why", who and when. Edit happens in place; delete asks first.
 */
export function DecisionCard({
  number,
  text,
  rationale,
  createdAt,
  author,
  onEdit,
  onDelete,
}: DecisionCardProps) {
  const intl = useIntl()
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // The dialog stays open until the delete succeeds; a failure is shown in it.
  const confirmDelete = async () => {
    setDeleting(true)
    setDeleteError(null)
    try {
      await onDelete()
      setConfirming(false)
    } catch (e) {
      setDeleteError(
        e instanceof Error
          ? e.message
          : intl.formatMessage({
              id: 'task.decisions.deleteFailed',
              defaultMessage: 'Could not delete the decision',
            })
      )
    } finally {
      setDeleting(false)
    }
  }
  const label = intl.formatMessage(
    { id: 'task.decisions.number', defaultMessage: 'Decision {number}' },
    { number }
  )

  if (editing) {
    return (
      <Card asChild>
        <li aria-label={label}>
          <p className='px-4 pt-4 text-caption text-muted-foreground tabular-nums'>
            {label}
          </p>
          <DecisionForm
            initial={{ text, rationale }}
            submitLabel={intl.formatMessage({
              id: 'common.save',
              defaultMessage: 'Save',
            })}
            onSubmit={async input => {
              await onEdit(input)
              setEditing(false)
            }}
            onCancel={() => setEditing(false)}
          />
        </li>
      </Card>
    )
  }

  const meta = [
    author?.name ??
      intl.formatMessage({
        id: 'task.decisions.importedAuthor',
        defaultMessage: 'Moved from the description',
      }),
    intl.formatDate(createdAt, { dateStyle: 'medium' }),
  ].join(' · ')

  return (
    <Card asChild>
      <li aria-label={label}>
        <CardHeader className='flex-row items-start gap-3 space-y-0 p-4 pb-2'>
          <div className='min-w-0 flex-1 space-y-1'>
            <p className='text-caption text-muted-foreground tabular-nums'>
              {label}
            </p>
            <p
              className={`text-body-strong text-foreground break-words ${DECISION_INLINE_CLASS}`}
              dangerouslySetInnerHTML={{ __html: renderDecisionInline(text) }}
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                aria-label={intl.formatMessage(
                  {
                    id: 'task.decisions.actions',
                    defaultMessage: 'Actions for {decision}',
                  },
                  { decision: label }
                )}
              >
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <Pencil size={14} />
                {intl.formatMessage({
                  id: 'common.edit',
                  defaultMessage: 'Edit',
                })}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className='text-danger-text'
                onSelect={() => setConfirming(true)}
              >
                <Trash2 size={14} />
                {intl.formatMessage({
                  id: 'common.delete',
                  defaultMessage: 'Delete',
                })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>
        <CardContent className='space-y-2 p-4 pt-0'>
          {rationale ? (
            <p className='text-body text-muted-foreground break-words'>
              <span className='text-foreground'>
                {intl.formatMessage({
                  id: 'task.decisions.why',
                  defaultMessage: 'Why',
                })}{' '}
              </span>
              <span
                className={DECISION_INLINE_CLASS}
                dangerouslySetInnerHTML={{
                  __html: renderDecisionInline(rationale),
                }}
              />
            </p>
          ) : null}
          <div className='flex items-center gap-2 text-caption text-muted-foreground'>
            {author ? (
              <MemberAvatar
                name={author.name}
                imageUrl={author.imageUrl ?? undefined}
                size='sm'
                decorative
              />
            ) : null}
            <span>{meta}</span>
          </div>
        </CardContent>
        <AlertDialog
          open={confirming}
          onOpenChange={open => {
            setConfirming(open)
            if (!open) setDeleteError(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {intl.formatMessage(
                  {
                    id: 'task.decisions.deleteTitle',
                    defaultMessage: 'Delete {decision}?',
                  },
                  { decision: label }
                )}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {intl.formatMessage({
                  id: 'task.decisions.deleteBody',
                  defaultMessage:
                    'It is removed from the task for everyone; its number is not reused. The task Activity keeps a record.',
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {deleteError ? (
              <p role='alert' className='text-caption text-danger-text'>
                {deleteError}
              </p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel>
                {intl.formatMessage({
                  id: 'common.cancel',
                  defaultMessage: 'Cancel',
                })}
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting}
                onClick={e => {
                  // Radix closes the dialog on click; keep it until we know.
                  e.preventDefault()
                  void confirmDelete()
                }}
              >
                {intl.formatMessage({
                  id: 'common.delete',
                  defaultMessage: 'Delete',
                })}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </li>
    </Card>
  )
}
