export interface DecisionValue {
  summary: string
  what: string
  why: string
  alternatives: string
  implications: string
}

export const decisionDefault = (): DecisionValue => ({
  summary: '',
  what: '',
  why: '',
  alternatives: '',
  implications: '',
})

export const decisionIsValid = (v: DecisionValue) =>
  v.what.trim().length > 0 && v.why.trim().length > 0

export function decisionToContent(v: DecisionValue) {
  return {
    ...(v.summary.trim() ? { summary: v.summary.trim() } : {}),
    what: v.what.trim(),
    why: v.why.trim(),
    ...(v.alternatives.trim() ? { alternatives: v.alternatives.trim() } : {}),
    ...(v.implications.trim() ? { implications: v.implications.trim() } : {}),
  }
}

export function decisionFromContent(c: unknown): DecisionValue {
  const o = (c ?? {}) as Partial<DecisionValue>
  return {
    summary: o.summary ?? '',
    what: o.what ?? '',
    why: o.why ?? '',
    alternatives: o.alternatives ?? '',
    implications: o.implications ?? '',
  }
}
