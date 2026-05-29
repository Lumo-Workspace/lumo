export interface TrapValue {
  trigger: string
  outcome: string
  workaround: string
}

export const trapDefault = (): TrapValue => ({ trigger: '', outcome: '', workaround: '' })

export const trapIsValid = (v: TrapValue) =>
  v.trigger.trim().length > 0 && v.outcome.trim().length > 0

export function trapToContent(v: TrapValue) {
  return {
    trigger: v.trigger.trim(),
    outcome: v.outcome.trim(),
    ...(v.workaround.trim() ? { workaround: v.workaround.trim() } : {}),
  }
}

export function trapFromContent(c: unknown): TrapValue {
  const o = (c ?? {}) as Partial<TrapValue>
  return { trigger: o.trigger ?? '', outcome: o.outcome ?? '', workaround: o.workaround ?? '' }
}
