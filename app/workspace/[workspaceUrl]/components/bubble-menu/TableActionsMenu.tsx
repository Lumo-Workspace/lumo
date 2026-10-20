'use client'

import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import type { Editor } from '@tiptap/core'
import {
  Table2,
  ChevronDown,
  BetweenHorizontalStart,
  BetweenHorizontalEnd,
  BetweenVerticalStart,
  BetweenVerticalEnd,
  PanelTop,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useEditorSubmenu } from './useEditorSubmenu'

const ITEM_IDLE = 'hover:bg-accent hover:text-accent-foreground'
const ITEM_DANGER =
  'text-danger-text hover:bg-destructive/10 focus:bg-destructive/10 focus:text-danger-text'

export function TableActionsMenu({
  editor,
  canMergeCells,
  canSplitCell,
}: {
  editor: Editor
  canMergeCells: boolean
  canSplitCell: boolean
}) {
  const intl = useIntl()
  const { open, setOpen, triggerProps, contentProps, itemProps } =
    useEditorSubmenu(editor)
  const [confirmDeleteTable, setConfirmDeleteTable] = useState(false)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function disarmConfirm() {
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = null
    }
    setConfirmDeleteTable(false)
  }

  // Clear any pending confirm timer on unmount
  useEffect(
    () => () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    },
    []
  )

  // Reset the delete-confirm (and its timer) whenever the menu closes, so it
  // can't linger across a reopen.
  function handleOpenChange(next: boolean) {
    if (!next) disarmConfirm()
    setOpen(next)
  }

  function handleDeleteTableSelect(e: Event) {
    if (confirmDeleteTable) {
      disarmConfirm()
      editor.chain().focus().deleteTable().run()
      return
    }
    // First click arms the confirm: keep the menu open for the second one.
    e.preventDefault()
    setConfirmDeleteTable(true)
    confirmTimerRef.current = setTimeout(() => {
      setConfirmDeleteTable(false)
      confirmTimerRef.current = null
    }, 3000)
  }

  const actions = [
    {
      id: 'table.addRowAbove',
      icon: <BetweenHorizontalStart />,
      run: () => editor.chain().focus().addRowBefore().run(),
    },
    {
      id: 'table.addRowBelow',
      icon: <BetweenHorizontalEnd />,
      run: () => editor.chain().focus().addRowAfter().run(),
    },
    {
      id: 'table.addColLeft',
      icon: <BetweenVerticalStart />,
      run: () => editor.chain().focus().addColumnBefore().run(),
    },
    {
      id: 'table.addColRight',
      icon: <BetweenVerticalEnd />,
      run: () => editor.chain().focus().addColumnAfter().run(),
    },
  ]
  const structure = [
    {
      id: 'table.toggleHeaderRow',
      icon: <PanelTop />,
      disabled: false,
      run: () => editor.chain().focus().toggleHeaderRow().run(),
    },
    {
      id: 'table.mergeCells',
      icon: <TableCellsMerge />,
      disabled: !canMergeCells,
      run: () => editor.chain().focus().mergeCells().run(),
    },
    {
      id: 'table.splitCell',
      icon: <TableCellsSplit />,
      disabled: !canSplitCell,
      run: () => editor.chain().focus().splitCell().run(),
    },
  ]
  const deletes = [
    {
      id: 'table.deleteRow',
      run: () => editor.chain().focus().deleteRow().run(),
    },
    {
      id: 'table.deleteCol',
      run: () => editor.chain().focus().deleteColumn().run(),
    },
  ]

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange} modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              aria-label={intl.formatMessage({ id: 'table.actions' })}
              {...triggerProps}
              className='flex items-center gap-1 px-1.5 h-7 rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground transition-colors'
            >
              <Table2 size={14} />
              <ChevronDown size={12} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {intl.formatMessage({ id: 'table.actions' })}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align='start'
        className='min-w-[180px]'
        {...contentProps}
      >
        {/* rows / cols */}
        {actions.map(a => (
          <DropdownMenuItem
            key={a.id}
            {...itemProps}
            onSelect={() => {
              disarmConfirm()
              a.run()
            }}
            className={ITEM_IDLE}
          >
            {a.icon}
            {intl.formatMessage({ id: a.id })}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        {/* structure */}
        {structure.map(a => (
          <DropdownMenuItem
            key={a.id}
            {...itemProps}
            disabled={a.disabled}
            onSelect={() => {
              disarmConfirm()
              a.run()
            }}
            className={cn(!a.disabled && ITEM_IDLE)}
          >
            {a.icon}
            {intl.formatMessage({ id: a.id })}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        {/* delete */}
        {deletes.map(a => (
          <DropdownMenuItem
            key={a.id}
            {...itemProps}
            onSelect={() => {
              disarmConfirm()
              a.run()
            }}
            className={ITEM_DANGER}
          >
            <Trash2 />
            {intl.formatMessage({ id: a.id })}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem
          {...itemProps}
          onSelect={handleDeleteTableSelect}
          className={cn(ITEM_DANGER, confirmDeleteTable && 'bg-destructive/10')}
        >
          <Trash2 />
          {intl.formatMessage({
            id: confirmDeleteTable
              ? 'table.deleteTableConfirm'
              : 'table.deleteTable',
          })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
