/**
 * LUM-998 — deterministic train / held-out split.
 *
 * New detector patterns are written from the TRAIN half's misses (and checked
 * against the TRAIN half's benign samples); the HELD-OUT half is only ever
 * measured. The split is a pure function of the sample's identity, so anyone
 * re-running the bench gets the same halves: the first hex digit of
 * sha256(`dataset \0 ref`), 0-7 → train, 8-f → held-out.
 */
import { wilson, type Rate } from './classify'
import { sha256, type Label } from './sources'

export type Split = 'train' | 'heldout'

export const SPLITS: readonly Split[] = ['train', 'heldout']

export function splitOf(s: { dataset: string; ref: string }): Split {
  const first = sha256(`${s.dataset}\u0000${s.ref}`)[0] ?? '0'
  return parseInt(first, 16) < 8 ? 'train' : 'heldout'
}

export interface SplitRates {
  attacks: Rate
  publicBenign: Rate
  lumoBenign: Rate
}

/** Pooled flagged rate per split for the three headline pools. */
export function splitRates(
  scored: Array<{
    dataset: string
    ref: string
    label: Label
    score: { flagged: boolean }
  }>,
  pools: { attacks: string[]; publicBenign: string[]; lumoBenign: string[] }
): Record<Split, SplitRates> {
  const rate = (split: Split, ids: string[]): Rate => {
    const mine = scored.filter(
      s => ids.includes(s.dataset) && splitOf(s) === split
    )
    return wilson(mine.filter(s => s.score.flagged).length, mine.length)
  }
  const out = {} as Record<Split, SplitRates>
  for (const split of SPLITS)
    out[split] = {
      attacks: rate(split, pools.attacks),
      publicBenign: rate(split, pools.publicBenign),
      lumoBenign: rate(split, pools.lumoBenign),
    }
  return out
}
