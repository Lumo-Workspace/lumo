export interface TrapValue {
  summary: string
  trigger: string
  outcome: string
  workaround: string
}

export const trapDefault = (): TrapValue => ({
  summary: '',
  trigger: '',
  outcome: '',
  workaround: '',
})

export const trapIsValid = (v: TrapValue) =>
  v.trigger.trim().length > 0 && v.outcome.trim().length > 0

export function trapToContent(v: TrapValue) {
  return {
    ...(v.summary.trim() ? { summary: v.summary.trim() } : {}),
    trigger: v.trigger.trim(),
    outcome: v.outcome.trim(),
    ...(v.workaround.trim() ? { workaround: v.workaround.trim() } : {}),
  }
}

export function trapFromContent(c: unknown): TrapValue {
  const o = (c ?? {}) as Partial<TrapValue>
  return {
    summary: o.summary ?? '',
    trigger: o.trigger ?? '',
    outcome: o.outcome ?? '',
    workaround: o.workaround ?? '',
  }
}
