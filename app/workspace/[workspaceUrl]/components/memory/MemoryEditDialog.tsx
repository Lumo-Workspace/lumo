'use client'

import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import type { MemoryCategory } from '@prisma/client'
import type { MemoryRow } from '@/lib/api-client'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  TrapForm,
  trapDefault,
  trapIsValid,
  trapToContent,
  trapFromContent,
  type TrapValue,
} from './forms/TrapForm'
import {
  DecisionForm,
  decisionDefault,
  decisionIsValid,
  decisionToContent,
  decisionFromContent,
  type DecisionValue,
} from './forms/DecisionForm'
import {
  ConventionForm,
  conventionDefault,
  conventionIsValid,
  conventionToContent,
  conventionFromContent,
  type ConventionValue,
} from './forms/ConventionForm'
import {
  ProceduralForm,
  proceduralDefault,
  proceduralIsValid,
  proceduralToContent,
  proceduralFromContent,
  type ProceduralValue,
} from './forms/ProceduralForm'

export interface MemorySubmitPayload {
  category: MemoryCategory
  content: unknown
}

interface MemoryEditDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  editing?: MemoryRow
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: MemorySubmitPayload) => void | Promise<void>
  submitting: boolean
}

const CATEGORIES: MemoryCategory[] = ['TRAP', 'DECISION', 'CONVENTION', 'PROCEDURAL']

const CATEGORY_LABEL_ID: Record<MemoryCategory, string> = {
  TRAP: 'memory.category.trap',
  DECISION: 'memory.category.decision',
  CONVENTION: 'memory.category.convention',
  PROCEDURAL: 'memory.category.procedural',
}

type FormState =
  | { category: 'TRAP'; value: TrapValue }
  | { category: 'DECISION'; value: DecisionValue }
  | { category: 'CONVENTION'; value: ConventionValue }
  | { category: 'PROCEDURAL'; value: ProceduralValue }

function initialState(row?: MemoryRow): FormState | null {
  if (!row) return null
  switch (row.category) {
    case 'TRAP':
      return { category: 'TRAP', value: trapFromContent(row.content) }
    case 'DECISION':
      return { category: 'DECISION', value: decisionFromContent(row.content) }
    case 'CONVENTION':
      return { category: 'CONVENTION', value: conventionFromContent(row.content) }
    case 'PROCEDURAL':
      return { category: 'PROCEDURAL', value: proceduralFromContent(row.content) }
  }
}

function blankState(category: MemoryCategory): FormState {
  switch (category) {
    case 'TRAP':
      return { category: 'TRAP', value: trapDefault() }
    case 'DECISION':
      return { category: 'DECISION', value: decisionDefault() }
    case 'CONVENTION':
      return { category: 'CONVENTION', value: conventionDefault() }
    case 'PROCEDURAL':
      return { category: 'PROCEDURAL', value: proceduralDefault() }
  }
}

function isValid(s: FormState): boolean {
  switch (s.category) {
    case 'TRAP':
      return trapIsValid(s.value)
    case 'DECISION':
      return decisionIsValid(s.value)
    case 'CONVENTION':
      return conventionIsValid(s.value)
    case 'PROCEDURAL':
      return proceduralIsValid(s.value)
  }
}

function toContent(s: FormState): unknown {
  switch (s.category) {
    case 'TRAP':
      return trapToContent(s.value)
    case 'DECISION':
      return decisionToContent(s.value)
    case 'CONVENTION':
      return conventionToContent(s.value)
    case 'PROCEDURAL':
      return proceduralToContent(s.value)
  }
}

export function MemoryEditDialog({
  open,
  mode,
  editing,
  onOpenChange,
  onSubmit,
  submitting,
}: MemoryEditDialogProps) {
  const intl = useIntl()
  const [state, setState] = useState<FormState | null>(() =>
    mode === 'edit' ? initialState(editing) : null
  )

  // Reset the form whenever the dialog (re)opens, so a reused instance never
  // shows the previous row's data. Depends on `open` only — re-running on
  // mode/editing changes mid-open would clobber in-progress input. Consumers
  // may still remount via React key; this is the defensive belt-and-suspenders.
  useEffect(() => {
    if (open) setState(mode === 'edit' ? initialState(editing) : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const titleId = mode === 'create' ? 'memory.dialog.create.title' : 'memory.dialog.edit.title'
  const ctaId = mode === 'create' ? 'memory.dialog.create.cta' : 'memory.dialog.edit.cta'

  const handleSubmit = async () => {
    if (!state || !isValid(state)) return
    await onSubmit({ category: state.category, content: toContent(state) })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: titleId })}</DialogTitle>
        </DialogHeader>

        {mode === 'create' && !state && (
          <div className='space-y-2'>
            <p className='text-sm text-zinc-500'>
              {intl.formatMessage({ id: 'memory.dialog.categoryStep' })}
            </p>
            <div className='grid grid-cols-2 gap-2'>
              {CATEGORIES.map(cat => (
                <Button key={cat} type='button' variant='outline' onClick={() => setState(blankState(cat))}>
                  {intl.formatMessage({ id: CATEGORY_LABEL_ID[cat] })}
                </Button>
              ))}
            </div>
          </div>
        )}

        {state && (
          <>
            {state.category === 'TRAP' && (
              <TrapForm value={state.value} onChange={v => setState({ category: 'TRAP', value: v })} />
            )}
            {state.category === 'DECISION' && (
              <DecisionForm value={state.value} onChange={v => setState({ category: 'DECISION', value: v })} />
            )}
            {state.category === 'CONVENTION' && (
              <ConventionForm value={state.value} onChange={v => setState({ category: 'CONVENTION', value: v })} />
            )}
            {state.category === 'PROCEDURAL' && (
              <ProceduralForm value={state.value} onChange={v => setState({ category: 'PROCEDURAL', value: v })} />
            )}
            <DialogFooter>
              <Button type='button' variant='ghost' onClick={() => onOpenChange(false)}>
                {intl.formatMessage({ id: 'memory.dialog.cancel' })}
              </Button>
              <Button type='button' disabled={!isValid(state) || submitting} onClick={handleSubmit}>
                {intl.formatMessage({ id: ctaId })}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
