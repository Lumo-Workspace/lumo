'use client'

import type { ReactNode } from 'react'
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
 * One sedimented memory rendered as a neutral, white-bodied card.
 *
 * Color is an INDEX, not a fill: `item.category` drives only a 3px
 * left accent stripe and a small category pill (TRAP red, DECISION
 * blue, CONVENTION amber, PROCEDURAL emerald). The card body stays
 * neutral so a list of memories reads as a quiet column of knowledge
 * entries with a colored "spine" for at-a-glance categorization —
 * not a wall of alert-colored blocks.
 *
 * Layout is a three-tier scan: title → field section-labels → content.
 *
 * `source` (e.g. "由 Claude 沉淀") renders as a chip in the top-right,
 * opposite the category pill — left says "what kind", right says "who
 * sedimented it". The "沉淀记忆" branding (sparkles) is shown by
 * default in the top-right when no explicit `source` is given; set
 * `showSedimentedLabel={false}` when the surrounding context already
 * labels the section as memories.
 */
interface MemoryCardItem {
  id: string
  category: MemoryCategory
  content: unknown
}

interface MemoryCardProps {
  item: MemoryCardItem
  /** Top-right attribution chip (e.g. "由 Claude 沉淀"). Takes
   *  precedence over the default sparkles branding. In a hover-group
   *  context it fades out so an action menu can take the corner. */
  source?: ReactNode
  /** Show the default "沉淀记忆" sparkles chip in the top-right when no
   *  `source` is given. Defaults to true; set false when the
   *  surrounding context (e.g. a TurnCard) already has its own
   *  "memory sedimented this turn" header and the per-card chip
   *  becomes redundant. */
  showSedimentedLabel?: boolean
}

interface CategoryStyle {
  /** Tailwind bg class for the 3px left accent stripe (the "spine"). */
  accent: string
  /** Pill background + text used for the category label. */
  pill: string
  /** Translation key for the category display name. */
  labelId: string
}

const CATEGORY_STYLES: Record<MemoryCategory, CategoryStyle> = {
  TRAP: {
    accent: 'bg-red-500',
    pill: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
    labelId: 'memory.category.trap',
  },
  DECISION: {
    accent: 'bg-blue-500',
    pill: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
    labelId: 'memory.category.decision',
  },
  CONVENTION: {
    accent: 'bg-amber-500',
    pill: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    labelId: 'memory.category.convention',
  },
  PROCEDURAL: {
    accent: 'bg-emerald-500',
    pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    labelId: 'memory.category.procedural',
  },
}

export function MemoryCard({
  item,
  source,
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
    <div className='relative overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'>
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-[3px] ${style.accent}`}
      />
      <div className='py-3 pl-4 pr-3'>
        <div className='mb-1.5 flex items-start justify-between gap-2'>
          <span
            className={`shrink-0 rounded px-1.5 py-px text-[10px] font-medium uppercase tracking-wide ${style.pill}`}
          >
            {intl.formatMessage({ id: style.labelId })}
          </span>
          {source ? (
            <span className='shrink-0 text-[10px] text-zinc-400 transition-opacity group-hover:opacity-0 dark:text-zinc-500'>
              {source}
            </span>
          ) : showSedimentedLabel ? (
            <span className='inline-flex shrink-0 items-center gap-1 text-[10px] text-violet-500 dark:text-violet-400'>
              <Sparkles className='size-3' />
              {intl.formatMessage({
                id: 'agentRun.memorySedimented',
                defaultMessage: '沉淀记忆',
              })}
            </span>
          ) : null}
        </div>
        <MemoryBody category={item.category} parsed={parsed} />
      </div>
    </div>
  )
}

/** Small uppercase gray section label sitting above its content, giving
 *  each card a "title → field label → content" scan structure. */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='mt-2.5'>
      <p className='text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500'>
        {label}
      </p>
      <div className='mt-0.5 text-sm text-zinc-700 dark:text-zinc-300'>
        {children}
      </div>
    </div>
  )
}

/** The card title: medium weight (not bold), capped at two lines. */
function Title({ children }: { children: ReactNode }) {
  return (
    <p className='line-clamp-2 text-sm font-medium leading-snug text-zinc-900 dark:text-zinc-100'>
      {children}
    </p>
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
  const label = (id: string) => intl.formatMessage({ id })

  switch (category) {
    case 'TRAP': {
      const c = parsed as TrapContent
      return (
        <>
          <Title>{c.trigger}</Title>
          <Section label={label('memory.section.outcome')}>{c.outcome}</Section>
          {c.workaround && (
            <Section label={label('memory.section.workaround')}>
              {c.workaround}
            </Section>
          )}
        </>
      )
    }
    case 'DECISION': {
      const c = parsed as DecisionContent
      return (
        <>
          <Title>{c.what}</Title>
          <Section label={label('memory.section.why')}>{c.why}</Section>
          {c.alternatives && (
            <Section label={label('memory.section.alternatives')}>
              {c.alternatives}
            </Section>
          )}
          {c.implications && (
            <Section label={label('memory.section.implications')}>
              {c.implications}
            </Section>
          )}
        </>
      )
    }
    case 'CONVENTION': {
      const c = parsed as ConventionContent
      return (
        <>
          <Title>{c.rule}</Title>
          <Section label={label('memory.section.scope')}>{c.scope}</Section>
        </>
      )
    }
    case 'PROCEDURAL': {
      const c = parsed as ProceduralContent
      return (
        <>
          <Title>{c.workflow}</Title>
          <Section label={label('memory.section.trigger')}>{c.trigger}</Section>
          {c.steps && c.steps.length > 0 && (
            <Section label={label('memory.section.steps')}>
              <ol className='ml-4 list-decimal space-y-0.5 marker:text-zinc-400 dark:marker:text-zinc-600'>
                {c.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </Section>
          )}
        </>
      )
    }
  }
}
