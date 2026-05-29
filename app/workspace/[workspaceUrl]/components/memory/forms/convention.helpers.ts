export interface ConventionValue {
  rule: string
  scope: string
}

export const conventionDefault = (): ConventionValue => ({ rule: '', scope: '' })

export const conventionIsValid = (v: ConventionValue) =>
  v.rule.trim().length > 0 && v.scope.trim().length > 0

export function conventionToContent(v: ConventionValue) {
  return { rule: v.rule.trim(), scope: v.scope.trim() }
}

export function conventionFromContent(c: unknown): ConventionValue {
  const o = (c ?? {}) as Partial<ConventionValue>
  return { rule: o.rule ?? '', scope: o.scope ?? '' }
}
