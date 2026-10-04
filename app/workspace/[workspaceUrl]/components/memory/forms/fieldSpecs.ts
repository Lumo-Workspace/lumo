import type { MemoryCategory } from '@prisma/client'
import {
  type TrapValue,
  trapDefault,
  trapIsValid,
  trapToContent,
  trapFromContent,
} from './trap.helpers'
import {
  type DecisionValue,
  decisionDefault,
  decisionIsValid,
  decisionToContent,
  decisionFromContent,
} from './decision.helpers'
import {
  type ConventionValue,
  conventionDefault,
  conventionIsValid,
  conventionToContent,
  conventionFromContent,
} from './convention.helpers'
import {
  type ProceduralValue,
  proceduralDefault,
  proceduralIsValid,
  proceduralToContent,
  proceduralFromContent,
} from './procedural.helpers'

/**
 * The dialog's working state: every field is a plain text paragraph keyed by
 * field name, plus `summary` for the title line.
 *
 * The four category value types (TrapValue, DecisionValue, …) are the storage
 * shape; this flat record is the *editing* shape. They differ in exactly one
 * place — PROCEDURAL.steps is `string[]` in storage and one newline-separated
 * paragraph in the editor — so the two are kept apart rather than merged, and
 * each category spec owns the conversion.
 */
export type MemoryDraft = Record<string, string>

export interface MemoryFieldSpec {
  /** Key into the draft record. */
  key: string
  /** Translation key for the small uppercase section label. Deliberately the
   *  same `memory.section.*` key MemoryCard renders, so the field you type
   *  into and the field you later read carry identical wording. */
  labelId: string
  /** Translation key for the in-field prompt. */
  placeholderId: string
  required: boolean
}

export interface MemoryCategorySpec {
  labelId: string
  /** Tailwind bg class for the 7px category dot on the pill — the only spot
   *  of color in the dialog. */
  dot: string
  /** Translation key for the title line's placeholder (per category, because
   *  a good memory title reads differently for a pitfall vs a procedure). */
  summaryPlaceholderId: string
  fields: MemoryFieldSpec[]
  blank: () => MemoryDraft
  fromContent: (content: unknown) => MemoryDraft
  toContent: (draft: MemoryDraft) => unknown
  isValid: (draft: MemoryDraft) => boolean
}

/** Read a draft key as a string, tolerating a key the draft never set. */
const at = (d: MemoryDraft, key: string): string => d[key] ?? ''

const toTrap = (d: MemoryDraft): TrapValue => ({
  summary: at(d, 'summary'),
  trigger: at(d, 'trigger'),
  outcome: at(d, 'outcome'),
  workaround: at(d, 'workaround'),
})

const toDecision = (d: MemoryDraft): DecisionValue => ({
  summary: at(d, 'summary'),
  what: at(d, 'what'),
  why: at(d, 'why'),
  alternatives: at(d, 'alternatives'),
  implications: at(d, 'implications'),
})

const toConvention = (d: MemoryDraft): ConventionValue => ({
  summary: at(d, 'summary'),
  rule: at(d, 'rule'),
  scope: at(d, 'scope'),
})

const toProcedural = (d: MemoryDraft): ProceduralValue => ({
  summary: at(d, 'summary'),
  workflow: at(d, 'workflow'),
  trigger: at(d, 'trigger'),
  // One step per line. proceduralToContent trims and drops blanks, so a
  // trailing newline or an empty line between steps is harmless.
  steps: at(d, 'steps').split('\n'),
})

export const MEMORY_CATEGORY_SPECS: Record<MemoryCategory, MemoryCategorySpec> =
  {
    TRAP: {
      labelId: 'memory.category.trap',
      dot: 'bg-danger',
      summaryPlaceholderId: 'memory.field.trap.summary.placeholder',
      fields: [
        {
          key: 'trigger',
          labelId: 'memory.section.trigger',
          placeholderId: 'memory.field.trap.trigger.placeholder',
          required: true,
        },
        {
          key: 'outcome',
          labelId: 'memory.section.outcome',
          placeholderId: 'memory.field.trap.outcome.placeholder',
          required: true,
        },
        {
          key: 'workaround',
          labelId: 'memory.section.workaround',
          placeholderId: 'memory.field.trap.workaround.placeholder',
          required: false,
        },
      ],
      blank: () => ({ ...trapDefault() }),
      fromContent: c => ({ ...trapFromContent(c) }),
      toContent: d => trapToContent(toTrap(d)),
      isValid: d => trapIsValid(toTrap(d)),
    },

    DECISION: {
      labelId: 'memory.category.decision',
      dot: 'bg-info',
      summaryPlaceholderId: 'memory.field.decision.summary.placeholder',
      fields: [
        {
          key: 'what',
          labelId: 'memory.section.what',
          placeholderId: 'memory.field.decision.what.placeholder',
          required: true,
        },
        {
          key: 'why',
          labelId: 'memory.section.why',
          placeholderId: 'memory.field.decision.why.placeholder',
          required: true,
        },
        {
          key: 'alternatives',
          labelId: 'memory.section.alternatives',
          placeholderId: 'memory.field.decision.alternatives.placeholder',
          required: false,
        },
        {
          key: 'implications',
          labelId: 'memory.section.implications',
          placeholderId: 'memory.field.decision.implications.placeholder',
          required: false,
        },
      ],
      blank: () => ({ ...decisionDefault() }),
      fromContent: c => ({ ...decisionFromContent(c) }),
      toContent: d => decisionToContent(toDecision(d)),
      isValid: d => decisionIsValid(toDecision(d)),
    },

    CONVENTION: {
      labelId: 'memory.category.convention',
      dot: 'bg-warning-text',
      summaryPlaceholderId: 'memory.field.convention.summary.placeholder',
      fields: [
        {
          key: 'rule',
          labelId: 'memory.section.rule',
          placeholderId: 'memory.field.convention.rule.placeholder',
          required: true,
        },
        {
          key: 'scope',
          labelId: 'memory.section.scope',
          placeholderId: 'memory.field.convention.scope.placeholder',
          required: true,
        },
      ],
      blank: () => ({ ...conventionDefault() }),
      fromContent: c => ({ ...conventionFromContent(c) }),
      toContent: d => conventionToContent(toConvention(d)),
      isValid: d => conventionIsValid(toConvention(d)),
    },

    PROCEDURAL: {
      labelId: 'memory.category.procedural',
      dot: 'bg-success-text',
      summaryPlaceholderId: 'memory.field.procedural.summary.placeholder',
      fields: [
        {
          key: 'workflow',
          labelId: 'memory.section.workflow',
          placeholderId: 'memory.field.procedural.workflow.placeholder',
          required: true,
        },
        {
          key: 'trigger',
          labelId: 'memory.section.trigger',
          placeholderId: 'memory.field.procedural.trigger.placeholder',
          required: true,
        },
        {
          key: 'steps',
          labelId: 'memory.section.steps',
          placeholderId: 'memory.field.procedural.steps.placeholder',
          required: false,
        },
      ],
      blank: () => {
        const v = proceduralDefault()
        return {
          summary: v.summary,
          workflow: v.workflow,
          trigger: v.trigger,
          steps: v.steps.join('\n'),
        }
      },
      fromContent: c => {
        const v = proceduralFromContent(c)
        return {
          summary: v.summary,
          workflow: v.workflow,
          trigger: v.trigger,
          steps: v.steps.join('\n'),
        }
      },
      toContent: d => proceduralToContent(toProcedural(d)),
      isValid: d => proceduralIsValid(toProcedural(d)),
    },
  }

/** Pill order in the dialog — the same order the categories are listed in
 *  everywhere else in the product. */
export const MEMORY_CATEGORIES: MemoryCategory[] = [
  'TRAP',
  'DECISION',
  'CONVENTION',
  'PROCEDURAL',
]
