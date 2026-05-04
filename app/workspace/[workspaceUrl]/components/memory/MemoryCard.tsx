'use client'

import { useIntl } from 'react-intl'
import { Sparkles } from 'lucide-react'
import type { MemoryCategory } from '@prisma/client'
import {
  parseMemoryContent,
  type TrapContent,
  type DecisionContent,
  type ConventionContent,
  type ProceduralContent,
} from '@/lib/memory/schemas'

/**
 * One sedimented memory rendered as a category-colored card. Color is
 * driven entirely by `item.category` (TRAP red, DECISION blue,
 * CONVENTION amber, PROCEDURAL emerald) so a glance reads category
 * before content.
 *
 * The "this is a memory" branding (sparkles icon + 沉淀记忆 label) is
 * shown by default — set `showSedimentedLabel={false}` when the
 * surrounding context already labels the section as memories.
 */
interface MemoryCardItem {
  id: string
  category: MemoryCategory
  content: unknown
}

interface MemoryCardProps {
  item: MemoryCardItem
  /** Show the "沉淀记忆" header pill. Defaults to true; set false when
   *  the surrounding context (e.g. a TurnCard) already has its own
   *  "memory sedimented this turn" header and the per-card header
   *  becomes redundant. */
  showSedimentedLabel?: boolean
}

interface CategoryStyle {
  /** Tailwind classes for the card's border-l accent + outer border. */
  border: string
  /** Background tint that signals category at a glance. */
  bg: string
  /** Pill background + text used for the category label inside the card. */
  pill: string
  /** Translation key for the category display name. */
  labelId: string
}

const CATEGORY_STYLES: Record<MemoryCategory, CategoryStyle> = {
  TRAP: {
    border:
      'border-l-4 border-l-red-500 border border-red-200 dark:border-red-900/60',
    bg: 'bg-red-50 dark:bg-red-950/30',
    pill: 'text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/50',
    labelId: 'memory.category.trap',
  },
  DECISION: {
    border:
      'border-l-4 border-l-blue-500 border border-blue-200 dark:border-blue-900/60',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    pill: 'text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/50',
    labelId: 'memory.category.decision',
  },
  CONVENTION: {
    border:
      'border-l-4 border-l-amber-500 border border-amber-200 dark:border-amber-900/60',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    pill: 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/50',
    labelId: 'memory.category.convention',
  },
  PROCEDURAL: {
    border:
      'border-l-4 border-l-emerald-500 border border-emerald-200 dark:border-emerald-900/60',
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    pill: 'text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/50',
    labelId: 'memory.category.procedural',
  },
}

export function MemoryCard({
  item,
  showSedimentedLabel = true,
}: MemoryCardProps) {
  const intl = useIntl()
  const style = CATEGORY_STYLES[item.category]

  let parsed: unknown
  try {
    parsed = parseMemoryContent(item.category, item.content)
  } catch {
    return null
  }

  return (
    <div className={`rounded-md ${style.border} ${style.bg} px-4 py-3`}>
      <div className='flex items-center gap-2 mb-1.5'>
        {showSedimentedLabel && (
          <>
            <Sparkles className='size-3.5 text-violet-500' />
            <span className='text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300'>
              {intl.formatMessage({
                id: 'agentRun.memorySedimented',
                defaultMessage: '沉淀记忆',
              })}
            </span>
          </>
        )}
        <span
          className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-px rounded ${style.pill}`}
        >
          {intl.formatMessage({ id: style.labelId })}
        </span>
      </div>
      <MemoryBody category={item.category} parsed={parsed} />
    </div>
  )
}

function MemoryBody({
  category,
  parsed,
}: {
  category: MemoryCategory
  parsed: unknown
}) {
  const intl = useIntl()

  switch (category) {
    case 'TRAP': {
      const c = parsed as TrapContent
      return (
        <div className='text-sm text-zinc-800 dark:text-zinc-200'>
          <p className='font-semibold'>{c.trigger}</p>
          <p className='text-xs text-zinc-600 dark:text-zinc-400 mt-1'>
            {c.outcome}
          </p>
          {c.workaround && (
            <p className='text-xs text-emerald-700 dark:text-emerald-400 mt-1'>
              {intl.formatMessage(
                { id: 'memory.field.workaround' },
                { value: c.workaround }
              )}
            </p>
          )}
        </div>
      )
    }
    case 'DECISION': {
      const c = parsed as DecisionContent
      return (
        <div className='text-sm text-zinc-800 dark:text-zinc-200'>
          <p className='font-semibold'>{c.what}</p>
          <p className='text-xs text-zinc-600 dark:text-zinc-400 mt-1'>
            {intl.formatMessage({ id: 'memory.field.why' }, { value: c.why })}
          </p>
          {c.alternatives && (
            <p className='text-xs text-zinc-600 dark:text-zinc-400 mt-1'>
              {intl.formatMessage(
                { id: 'memory.field.alternatives' },
                { value: c.alternatives }
              )}
            </p>
          )}
          {c.implications && (
            <p className='text-xs text-zinc-600 dark:text-zinc-400 mt-1'>
              {intl.formatMessage(
                { id: 'memory.field.implications' },
                { value: c.implications }
              )}
            </p>
          )}
        </div>
      )
    }
    case 'CONVENTION': {
      const c = parsed as ConventionContent
      return (
        <div className='text-sm text-zinc-800 dark:text-zinc-200'>
          <p className='font-semibold'>{c.rule}</p>
          <p className='text-xs text-zinc-600 dark:text-zinc-400 mt-1'>
            {intl.formatMessage(
              { id: 'memory.field.scope' },
              { value: c.scope }
            )}
          </p>
        </div>
      )
    }
    case 'PROCEDURAL': {
      const c = parsed as ProceduralContent
      return (
        <div className='text-sm text-zinc-800 dark:text-zinc-200'>
          <p className='font-semibold'>{c.workflow}</p>
          <p className='text-xs text-zinc-600 dark:text-zinc-400 mt-1'>
            {intl.formatMessage(
              { id: 'memory.field.trigger' },
              { value: c.trigger }
            )}
          </p>
          {c.steps && c.steps.length > 0 && (
            <ol className='text-xs mt-1.5 ml-4 list-decimal space-y-0.5 text-zinc-600 dark:text-zinc-400 marker:text-zinc-400 dark:marker:text-zinc-600'>
              {c.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          )}
        </div>
      )
    }
  }
}
