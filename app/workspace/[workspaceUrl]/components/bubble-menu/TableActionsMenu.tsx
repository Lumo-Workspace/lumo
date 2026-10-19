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
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const ITEM_BASE =
  'w-full text-left flex items-center gap-2 px-3 py-1.5 text-caption transition-colors'
const ITEM_IDLE =
  'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
const ITEM_DANGER = 'text-danger-text hover:bg-destructive/10'
const ITEM_DISABLED = 'text-muted-foreground opacity-40 cursor-not-allowed'

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
  const [open, setOpen] = useState(false)
  const [confirmDeleteTable, setConfirmDeleteTable] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear any pending confirm timer on unmount
  useEffect(
    () => () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    },
    []
  )

  // Close on outside click; reset the delete-confirm (and its timer) when the menu closes
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        if (confirmTimerRef.current) {
          clearTimeout(confirmTimerRef.current)
          confirmTimerRef.current = null
        }
        setOpen(false)
        setConfirmDeleteTable(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function runAndClose(fn: () => void) {
    // Disarm any pending delete-table confirm so it can't linger across a reopen
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = null
    }
    setConfirmDeleteTable(false)
    fn()
    setOpen(false)
  }

  function handleDeleteTableClick() {
    if (confirmDeleteTable) {
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current)
        confirmTimerRef.current = null
      }
      setConfirmDeleteTable(false)
      editor.chain().focus().deleteTable().run()
      setOpen(false)
    } else {
      setConfirmDeleteTable(true)
      confirmTimerRef.current = setTimeout(() => {
        setConfirmDeleteTable(false)
        confirmTimerRef.current = null
      }, 3000)
    }
  }

  return (
    <div ref={ref} className='relative'>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            aria-label={intl.formatMessage({ id: 'table.actions' })}
            aria-haspopup='menu'
            aria-expanded={open}
            onMouseDown={e => {
              e.preventDefault()
              setOpen(o => !o)
            }}
            className='flex items-center gap-1 px-1.5 h-7 rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors'
          >
            <Table2 size={14} />
            <ChevronDown size={12} />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {intl.formatMessage({ id: 'table.actions' })}
        </TooltipContent>
      </Tooltip>
      {open && (
        <div
          role='menu'
          className='absolute top-full left-0 mt-1 z-dropdown min-w-[180px] bg-popover text-popover-foreground border border-border rounded-md shadow-elevation-3 py-1'
        >
          {/* rows / cols */}
          <button
            role='menuitem'
            type='button'
            className={cn(ITEM_BASE, ITEM_IDLE)}
            onMouseDown={e => {
              e.preventDefault()
              runAndClose(() => editor.chain().focus().addRowBefore().run())
            }}
          >
            <BetweenHorizontalStart size={14} />
            {intl.formatMessage({ id: 'table.addRowAbove' })}
          </button>
          <button
            role='menuitem'
            type='button'
            className={cn(ITEM_BASE, ITEM_IDLE)}
            onMouseDown={e => {
              e.preventDefault()
              runAndClose(() => editor.chain().focus().addRowAfter().run())
            }}
          >
            <BetweenHorizontalEnd size={14} />
            {intl.formatMessage({ id: 'table.addRowBelow' })}
          </button>
          <button
            role='menuitem'
            type='button'
            className={cn(ITEM_BASE, ITEM_IDLE)}
            onMouseDown={e => {
              e.preventDefault()
              runAndClose(() => editor.chain().focus().addColumnBefore().run())
            }}
          >
            <BetweenVerticalStart size={14} />
            {intl.formatMessage({ id: 'table.addColLeft' })}
          </button>
          <button
            role='menuitem'
            type='button'
            className={cn(ITEM_BASE, ITEM_IDLE)}
            onMouseDown={e => {
              e.preventDefault()
              runAndClose(() => editor.chain().focus().addColumnAfter().run())
            }}
          >
            <BetweenVerticalEnd size={14} />
            {intl.formatMessage({ id: 'table.addColRight' })}
          </button>

          <Separator className='my-1' />

          {/* structure */}
          <button
            role='menuitem'
            type='button'
            className={cn(ITEM_BASE, ITEM_IDLE)}
            onMouseDown={e => {
              e.preventDefault()
              runAndClose(() => editor.chain().focus().toggleHeaderRow().run())
            }}
          >
            <PanelTop size={14} />
            {intl.formatMessage({ id: 'table.toggleHeaderRow' })}
          </button>
          <button
            role='menuitem'
            type='button'
            disabled={!canMergeCells}
            className={cn(ITEM_BASE, canMergeCells ? ITEM_IDLE : ITEM_DISABLED)}
            onMouseDown={e => {
              e.preventDefault()
              if (canMergeCells)
                runAndClose(() => editor.chain().focus().mergeCells().run())
            }}
          >
            <TableCellsMerge size={14} />
            {intl.formatMessage({ id: 'table.mergeCells' })}
          </button>
          <button
            role='menuitem'
            type='button'
            disabled={!canSplitCell}
            className={cn(ITEM_BASE, canSplitCell ? ITEM_IDLE : ITEM_DISABLED)}
            onMouseDown={e => {
              e.preventDefault()
              if (canSplitCell)
                runAndClose(() => editor.chain().focus().splitCell().run())
            }}
          >
            <TableCellsSplit size={14} />
            {intl.formatMessage({ id: 'table.splitCell' })}
          </button>

          <Separator className='my-1' />

          {/* delete */}
          <button
            role='menuitem'
            type='button'
            className={cn(ITEM_BASE, ITEM_DANGER)}
            onMouseDown={e => {
              e.preventDefault()
              runAndClose(() => editor.chain().focus().deleteRow().run())
            }}
          >
            <Trash2 size={13} />
            {intl.formatMessage({ id: 'table.deleteRow' })}
          </button>
          <button
            role='menuitem'
            type='button'
            className={cn(ITEM_BASE, ITEM_DANGER)}
            onMouseDown={e => {
              e.preventDefault()
              runAndClose(() => editor.chain().focus().deleteColumn().run())
            }}
          >
            <Trash2 size={13} />
            {intl.formatMessage({ id: 'table.deleteCol' })}
          </button>
          <button
            role='menuitem'
            type='button'
            className={cn(
              ITEM_BASE,
              confirmDeleteTable
                ? 'bg-destructive/10 text-danger-text'
                : ITEM_DANGER
            )}
            onMouseDown={e => {
              e.preventDefault()
              handleDeleteTableClick()
            }}
          >
            <Trash2 size={13} />
            {intl.formatMessage({
              id: confirmDeleteTable
                ? 'table.deleteTableConfirm'
                : 'table.deleteTable',
            })}
          </button>
        </div>
      )}
    </div>
  )
}
