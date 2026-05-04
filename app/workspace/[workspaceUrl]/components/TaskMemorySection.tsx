'use client'

import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { ChevronDown, ChevronRight, BrainCircuit } from 'lucide-react'
import { tasksClient } from '@/lib/api-client'
import type { MemoryCategory } from '@prisma/client'
import {
  parseMemoryContent,
  type TrapContent,
  type DecisionContent,
  type ConventionContent,
  type ProceduralContent,
} from '@/lib/memory/schemas'

interface MemoryItem {
  id: string
  category: MemoryCategory
  content: unknown
  createdAt: string
}

interface MemoriesResponse {
  memories: MemoryItem[]
}

const CATEGORY_ORDER: MemoryCategory[] = [
  'TRAP',
  'DECISION',
  'CONVENTION',
  'PROCEDURAL',
]

const CATEGORY_META: Record<
  MemoryCategory,
  { labelId: string; color: string }
> = {
  TRAP: {
    labelId: 'memory.category.trap',
    color: 'text-red-600 dark:text-red-400',
  },
  DECISION: {
    labelId: 'memory.category.decision',
    color: 'text-blue-600 dark:text-blue-400',
  },
  CONVENTION: {
    labelId: 'memory.category.convention',
    color: 'text-amber-600 dark:text-amber-400',
  },
  PROCEDURAL: {
    labelId: 'memory.category.procedural',
    color: 'text-emerald-600 dark:text-emerald-400',
  },
}

export function TaskMemorySection({ taskId }: { taskId: string }) {
  const intl = useIntl()
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<MemoryCategory, boolean>>({
    TRAP: true,
    DECISION: true,
    CONVENTION: true,
    PROCEDURAL: true,
  })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    tasksClient
      .getMemories<MemoriesResponse>(taskId)
      .then(data => {
        if (!cancelled) setMemories(data.memories)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [taskId])

  if (loading) return null
  if (memories.length === 0) return null

  const grouped = new Map<MemoryCategory, MemoryItem[]>()
  for (const m of memories) {
    const list = grouped.get(m.category) ?? []
    list.push(m)
    grouped.set(m.category, list)
  }

  return (
    <div className='mt-8'>
      <div className='flex items-center gap-2 mb-3'>
        <BrainCircuit className='size-4 text-violet-500' />
        <span className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider'>
          {intl.formatMessage({ id: 'memory.section.title' })}
        </span>
        <span className='text-[10px] text-zinc-400 dark:text-zinc-500'>
          {memories.length}
        </span>
      </div>

      <div className='space-y-3'>
        {CATEGORY_ORDER.map(cat => {
          const items = grouped.get(cat)
          if (!items || items.length === 0) return null
          const meta = CATEGORY_META[cat]
          const isExpanded = expanded[cat]
          return (
            <div key={cat}>
              <button
                type='button'
                onClick={() =>
                  setExpanded(prev => ({ ...prev, [cat]: !prev[cat] }))
                }
                className='flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors'
              >
                {isExpanded ? (
                  <ChevronDown className='size-3' />
                ) : (
                  <ChevronRight className='size-3' />
                )}
                <span className={meta.color}>
                  {intl.formatMessage({ id: meta.labelId })}
                </span>
                <span className='text-zinc-400 dark:text-zinc-600'>
                  ({items.length})
                </span>
              </button>
              {isExpanded && (
                <div className='mt-1.5 ml-4.5 space-y-1.5'>
                  {items.map(item => (
                    <MemoryCard key={item.id} item={item} intl={intl} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const CARD_CLASS =
  'text-sm text-zinc-600 dark:text-zinc-400 rounded-md bg-zinc-50 dark:bg-zinc-900 px-3 py-2 border border-zinc-100 dark:border-zinc-800'

function MemoryCard({
  item,
  intl,
}: {
  item: MemoryItem
  intl: ReturnType<typeof useIntl>
}) {
  let parsed
  try {
    parsed = parseMemoryContent(item.category, item.content)
  } catch {
    return (
      <div className={CARD_CLASS}>
        <p className='text-xs italic text-zinc-400'>
          {intl.formatMessage({ id: 'memory.unparseable' })}
        </p>
      </div>
    )
  }

  switch (item.category) {
    case 'TRAP': {
      const c = parsed as TrapContent
      return (
        <div className={CARD_CLASS}>
          <p className='font-medium text-zinc-800 dark:text-zinc-200'>
            {c.trigger}
          </p>
          <p className='text-xs mt-0.5'>{c.outcome}</p>
          {c.workaround && (
            <p className='text-xs mt-1 text-emerald-600 dark:text-emerald-400'>
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
        <div className={CARD_CLASS}>
          <p className='font-medium text-zinc-800 dark:text-zinc-200'>
            {c.what}
          </p>
          <p className='text-xs mt-0.5'>
            {intl.formatMessage({ id: 'memory.field.why' }, { value: c.why })}
          </p>
          {c.alternatives && (
            <p className='text-xs mt-1'>
              {intl.formatMessage(
                { id: 'memory.field.alternatives' },
                { value: c.alternatives }
              )}
            </p>
          )}
          {c.implications && (
            <p className='text-xs mt-1'>
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
        <div className={CARD_CLASS}>
          <p className='font-medium text-zinc-800 dark:text-zinc-200'>
            {c.rule}
          </p>
          <p className='text-xs mt-0.5'>
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
        <div className={CARD_CLASS}>
          <p className='font-medium text-zinc-800 dark:text-zinc-200'>
            {c.workflow}
          </p>
          <p className='text-xs mt-0.5'>
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
