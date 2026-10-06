/**
 * LUM-996 — turn scored samples into the committed read-out.
 *
 * Pure: no I/O. `run.ts` feeds it the corpora; the jest test feeds it
 * fixtures. Every ordering is deterministic (dataset order, then sha256 of the
 * text) so a re-run from scratch reproduces results.json byte for byte.
 */
import {
  categorizeMiss,
  detectLang,
  wilson,
  type Lang,
  type Rate,
} from './classify'
import {
  SCORE_KINDS,
  scoreText,
  type SampleScore,
  type ScoreKind,
} from './score'
import { sha256, type DatasetInfo, type Label, type Sample } from './sources'

export interface ScoredSample extends Sample {
  lang: Lang
  score: SampleScore
}

export const LANGS: readonly Lang[] = ['en', 'zh', 'de', 'other']
export const EXCERPT_CHARS = 160
export const TOP_CATEGORIES = 6
export const EXAMPLES_PER_CATEGORY = 3
export const MAX_FALSE_POSITIVES_LISTED = 40
export const PINNED_PER_OUTCOME = 6
export const PINNED_MAX_CHARS = 1200

export function scoreSamples(samples: Sample[]): ScoredSample[] {
  return samples.map(s => ({
    ...s,
    lang: detectLang(s.text),
    score: scoreText(s.text),
  }))
}

/** One-line, whitespace-collapsed excerpt for the read-out. */
export function excerptOf(text: string, max = EXCERPT_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`
}

/** Deterministic order independent of upstream row order: sha256(text), then ref. */
export function stableOrder<T extends { text: string; ref: string }>(
  xs: T[]
): T[] {
  return [...xs]
    .map(x => ({ x, h: sha256(x.text) }))
    .sort((a, b) =>
      a.h !== b.h
        ? a.h < b.h
          ? -1
          : 1
        : a.x.ref === b.x.ref
          ? 0
          : a.x.ref < b.x.ref
            ? -1
            : 1
    )
    .map(({ x }) => x)
}

/** Category a miss is filed under: the dataset's own (BIPIA) or the heuristic one. */
export function missCategory(s: ScoredSample): string {
  return s.nativeCategory !== undefined
    ? `BIPIA: ${s.nativeCategory}`
    : categorizeMiss(s.text, s.lang)
}

export interface MissedCategory {
  category: string
  misses: number
  /** Excerpts (quotable datasets) or sample refs (non-quotable). */
  examples: string[]
}

export interface DatasetResult {
  id: string
  label: Label
  title: string
  licence: string
  url: string
  revision: string
  note?: string
  /** Recall for attack sets, false-positive rate for benign sets. */
  flagged: Rate
  byKind: Record<ScoreKind, Rate>
  byLanguage: Partial<Record<Lang, Rate>>
  topMissedCategories?: MissedCategory[]
  falsePositives?: Array<{
    ref: string
    lang: Lang
    kinds: Partial<Record<ScoreKind, number>>
    excerpt: string
  }>
}

function byKindRates(scored: ScoredSample[]): Record<ScoreKind, Rate> {
  const out = {} as Record<ScoreKind, Rate>
  for (const k of SCORE_KINDS)
    out[k] = wilson(
      scored.filter(s => (s.score.kinds[k] ?? 0) > 0).length,
      scored.length
    )
  return out
}

function byLanguageRates(scored: ScoredSample[]): Partial<Record<Lang, Rate>> {
  const out: Partial<Record<Lang, Rate>> = {}
  for (const lang of LANGS) {
    const sub = scored.filter(s => s.lang === lang)
    if (sub.length > 0)
      out[lang] = wilson(sub.filter(s => s.score.flagged).length, sub.length)
  }
  return out
}

export function topMissedCategories(
  scored: ScoredSample[],
  isQuotable: (s: ScoredSample) => boolean
): MissedCategory[] {
  const groups = new Map<string, ScoredSample[]>()
  for (const s of scored) {
    if (s.label !== 'attack' || s.score.flagged) continue
    const cat = missCategory(s)
    groups.set(cat, [...(groups.get(cat) ?? []), s])
  }
  return [...groups.entries()]
    .filter(([, xs]) => xs.length >= EXAMPLES_PER_CATEGORY)
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
    .slice(0, TOP_CATEGORIES)
    .map(([category, xs]) => {
      // Quote licensed text first; fill from non-quotable sets by id only.
      const ordered = stableOrder(xs)
      const quoted = ordered.filter(isQuotable).map(s => excerptOf(s.text))
      const byRef = ordered
        .filter(s => !isQuotable(s))
        .map(s => `${s.dataset} sample_id ${s.ref}`)
      return {
        category,
        misses: xs.length,
        examples: [...quoted, ...byRef].slice(0, EXAMPLES_PER_CATEGORY),
      }
    })
}

export function summarizeDataset(
  info: DatasetInfo,
  scored: ScoredSample[]
): DatasetResult {
  const mine = scored.filter(s => s.dataset === info.id)
  const result: DatasetResult = {
    id: info.id,
    label: info.label,
    title: info.title,
    licence: info.licence,
    url: info.url,
    revision: info.revision,
    ...(info.note ? { note: info.note } : {}),
    flagged: wilson(mine.filter(s => s.score.flagged).length, mine.length),
    byKind: byKindRates(mine),
    byLanguage: byLanguageRates(mine),
  }
  if (info.label === 'attack') {
    result.topMissedCategories = topMissedCategories(mine, () => info.quotable)
  } else {
    result.falsePositives = [...mine]
      .filter(s => s.score.flagged)
      .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
      .slice(0, MAX_FALSE_POSITIVES_LISTED)
      .map(s => ({
        ref: s.ref,
        lang: s.lang,
        kinds: s.score.kinds,
        excerpt: info.quotable ? excerptOf(s.text) : '',
      }))
  }
  return result
}

export interface PooledResult {
  flagged: Rate
  byKind: Record<ScoreKind, Rate>
  byLanguage: Partial<Record<Lang, Rate>>
  topMissedCategories?: MissedCategory[]
}

/**
 * All samples of one label across `ids`, pooled. Miss categories count every
 * miss; examples quote only `quotableIds` datasets.
 */
export function pool(
  scored: ScoredSample[],
  ids: string[],
  label: Label,
  quotableIds: Set<string>
): PooledResult {
  const mine = scored.filter(s => s.label === label && ids.includes(s.dataset))
  const out: PooledResult = {
    flagged: wilson(mine.filter(s => s.score.flagged).length, mine.length),
    byKind: byKindRates(mine),
    byLanguage: byLanguageRates(mine),
  }
  if (label === 'attack')
    out.topMissedCategories = topMissedCategories(mine, s =>
      quotableIds.has(s.dataset)
    )
  return out
}

export interface PinnedSample {
  dataset: string
  ref: string
  text: string
  expected: SampleScore
}

/**
 * The fixture the jest test re-scores: per quotable dataset, up to
 * PINNED_PER_OUTCOME flagged and PINNED_PER_OUTCOME unflagged samples of
 * ≤ PINNED_MAX_CHARS, picked in stable (sha256) order.
 */
export function pinnedSample(
  scored: ScoredSample[],
  quotableIds: string[]
): PinnedSample[] {
  const out: PinnedSample[] = []
  for (const id of quotableIds) {
    const mine = stableOrder(
      scored.filter(s => s.dataset === id && s.text.length <= PINNED_MAX_CHARS)
    )
    for (const flagged of [true, false])
      for (const s of mine
        .filter(x => x.score.flagged === flagged)
        .slice(0, PINNED_PER_OUTCOME))
        out.push({
          dataset: s.dataset,
          ref: s.ref,
          text: s.text,
          expected: s.score,
        })
  }
  return out
}
