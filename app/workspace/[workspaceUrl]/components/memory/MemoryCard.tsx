'use client'

import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import type { MemoryCategory, TaskArtifactAgent } from '@prisma/client'
import { Card } from '@/components/ui/card'
import { AgentBadge } from '../AgentBadge'
import { ContentSignalsBadge } from '../ContentSignalsBadge'
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
 * Order comes from TYPOGRAPHY, not colored decoration. The whole card's
 * color budget is a single 7px category dot (TRAP red, DECISION blue,
 * CONVENTION amber, PROCEDURAL emerald) next to a gray category label;
 * everything else is grayscale. Hierarchy is carried by weight, size,
 * gray level, and spacing — a quiet column of knowledge entries, not a
 * templated stack of colored-accent cards. category is secondary
 * metadata (you read memories by content, not by category), so it gets
 * a minimal hint, not a full-height accent.
 *
 * Layout is a three-tier scan: title → field section-labels → content.
 *
 * `source` (e.g. "由 Claude 沉淀") renders in the top-right, opposite
 * the category dot — left says "what kind", right says "who produced it".
 * When no explicit `source` is given, the default top-right shows the
 * producing agent's badge (icon + name) via `AgentBadge`; set
 * `showSedimentedLabel={false}` when the surrounding context already
 * labels the section as memories and the per-card badge is redundant.
 */
interface MemoryCardItem {
  id: string
  category: MemoryCategory
  agent: TaskArtifactAgent
  content: unknown
  /** LUM-783: write-time injection scan of the content; null = clean. */
  contentSignals?: unknown
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
  /** Optional fragment-level trust badge (LUM-303), rendered next to the
   *  category label. A node, not a value, so MemoryCard stays unaware of
   *  lineage. Omit → nothing renders. */
  trustBadge?: ReactNode
}

interface CategoryStyle {
  /** Tailwind bg class for the 7px category dot — the card's single
   *  spot of color. */
  dot: string
  /** Translation key for the category display name. */
  labelId: string
}

const CATEGORY_STYLES: Record<MemoryCategory, CategoryStyle> = {
  TRAP: { dot: 'bg-danger', labelId: 'memory.category.trap' },
  DECISION: { dot: 'bg-info', labelId: 'memory.category.decision' },
  CONVENTION: { dot: 'bg-warning-text', labelId: 'memory.category.convention' },
  PROCEDURAL: { dot: 'bg-success-text', labelId: 'memory.category.procedural' },
}

export function MemoryCard({
  item,
  source,
  showSedimentedLabel = true,
  trustBadge,
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
    <Card className='rounded-md px-4 py-3'>
      <div className='mb-1.5 flex items-start justify-between gap-2'>
        <span className='flex shrink-0 items-center gap-1.5'>
          <span
            aria-hidden
            className={`size-[7px] shrink-0 rounded-full ${style.dot}`}
          />
          <span className='text-caption uppercase text-muted-foreground'>
            {intl.formatMessage({ id: style.labelId })}
          </span>
          {trustBadge}
          <ContentSignalsBadge signals={item.contentSignals} />
        </span>
        {source ? (
          <span className='shrink-0 text-caption text-muted-foreground transition-opacity group-hover:opacity-0'>
            {source}
          </span>
        ) : showSedimentedLabel ? (
          <AgentBadge agent={item.agent} />
        ) : null}
      </div>
      <MemoryBody category={item.category} parsed={parsed} />
    </Card>
  )
}

/** Small uppercase gray section label sitting above its content, giving
 *  each card a "title → field label → content" scan structure. */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='mt-2.5'>
      <p className='text-caption uppercase text-muted-foreground'>{label}</p>
      <div className='mt-0.5 text-body text-foreground'>{children}</div>
    </div>
  )
}

/** The card title: medium weight (not bold), capped at two lines. */
function Title({ children }: { children: ReactNode }) {
  return (
    <p className='line-clamp-2 text-body-strong text-foreground'>{children}</p>
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
          <Title>{c.summary ?? c.trigger}</Title>
          {c.summary && (
            <Section label={label('memory.section.trigger')}>
              {c.trigger}
            </Section>
          )}
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
          <Title>{c.summary ?? c.what}</Title>
          {c.summary && (
            <Section label={label('memory.section.what')}>{c.what}</Section>
          )}
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
          <Title>{c.summary ?? c.rule}</Title>
          {c.summary && (
            <Section label={label('memory.section.rule')}>{c.rule}</Section>
          )}
          <Section label={label('memory.section.scope')}>{c.scope}</Section>
        </>
      )
    }
    case 'PROCEDURAL': {
      const c = parsed as ProceduralContent
      return (
        <>
          <Title>{c.summary ?? c.workflow}</Title>
          {c.summary && (
            <Section label={label('memory.section.workflow')}>
              {c.workflow}
            </Section>
          )}
          <Section label={label('memory.section.trigger')}>{c.trigger}</Section>
          {c.steps && c.steps.length > 0 && (
            <Section label={label('memory.section.steps')}>
              <ol className='ml-4 list-decimal space-y-0.5 marker:text-muted-foreground'>
                {c.steps.map((step, i) => (
                  <li key={`${i}-${step}`}>{step}</li>
                ))}
              </ol>
            </Section>
          )}
        </>
      )
    }
  }
}
