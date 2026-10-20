/**
 * LUM-1289 — a P-label must mean the same priority whichever path parses it:
 * the rule parser (`PRIORITY_KEYWORDS`), both LLM prompt blocks, and the UI
 * labels in DuplicateConfirm.tsx (P0 URGENT, P1 HIGH, P2 MEDIUM, P3 LOW; P4 is
 * accepted as LOW).
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  QUICK_DISPATCH_SYSTEM_PROMPT,
  QUICK_DISPATCH_V2_SYSTEM_PROMPT,
} from '@/lib/prompts/quick-dispatch'
import {
  PRIORITY_KEYWORDS,
  parseQuickDispatch,
} from '@/lib/quick-dispatch/rule-parser'

const P_LABELS = ['P0', 'P1', 'P2', 'P3', 'P4'] as const

const EXPECTED: Record<(typeof P_LABELS)[number], string> = {
  P0: 'URGENT',
  P1: 'HIGH',
  P2: 'MEDIUM',
  P3: 'LOW',
  P4: 'LOW',
}

/** Parse `- P0, 紧急, urgent → URGENT` lines into { P0: 'URGENT', … }. */
function promptPLabelMap(prompt: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const line of prompt.split('\n')) {
    const m = line.match(/^-\s*(.+?)\s*→\s*(URGENT|HIGH|MEDIUM|LOW)\s*$/)
    if (!m) continue
    const [, lhs, priority] = m as unknown as [string, string, string]
    for (const token of lhs.split(',')) {
      const label = token.trim().match(/^P\d$/)?.[0]
      if (!label) continue
      expect(map[label]).toBeUndefined() // a label maps to exactly one priority
      map[label] = priority
    }
  }
  return map
}

/** Read the (unexported) PRIORITY_LABEL map from DuplicateConfirm.tsx. */
function uiLabelMap(): Record<string, string> {
  const src = readFileSync(
    join(
      process.cwd(),
      'app/workspace/[workspaceUrl]/components/DuplicateConfirm.tsx'
    ),
    'utf8'
  )
  const block = src.match(/PRIORITY_LABEL[^{]*\{([^}]*)\}/)?.[1] ?? ''
  const map: Record<string, string> = {}
  for (const m of block.matchAll(/(URGENT|HIGH|MEDIUM|LOW):\s*'(P\d)'/g)) {
    map[m[2] as string] = m[1] as string
  }
  return map
}

describe('LUM-1289 P-label → priority mapping', () => {
  it('the UI labels use the reference scale (P0 URGENT … P3 LOW)', () => {
    expect(uiLabelMap()).toEqual({
      P0: 'URGENT',
      P1: 'HIGH',
      P2: 'MEDIUM',
      P3: 'LOW',
    })
  })

  it.each([
    ['QUICK_DISPATCH_SYSTEM_PROMPT', QUICK_DISPATCH_SYSTEM_PROMPT],
    ['QUICK_DISPATCH_V2_SYSTEM_PROMPT', QUICK_DISPATCH_V2_SYSTEM_PROMPT],
  ])('%s maps P0–P4 onto the UI scale', (_name, prompt) => {
    expect(promptPLabelMap(prompt)).toEqual(EXPECTED)
  })

  it('the rule parser maps P0–P4 onto the same scale', () => {
    const map = Object.fromEntries(
      P_LABELS.map(label => [label, PRIORITY_KEYWORDS[label]])
    )
    expect(map).toEqual(EXPECTED)
  })

  it.each(P_LABELS)('rule parser and both prompts agree on %s', label => {
    const parser = PRIORITY_KEYWORDS[label]
    expect(promptPLabelMap(QUICK_DISPATCH_SYSTEM_PROMPT)[label]).toBe(parser)
    expect(promptPLabelMap(QUICK_DISPATCH_V2_SYSTEM_PROMPT)[label]).toBe(parser)
  })

  it('the rule parser reads a P4 create as LOW and strips it from the title', () => {
    const result = parseQuickDispatch('create fix login p4', [])
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toMatchObject({
      type: 'create',
      title: 'fix login',
      priority: 'LOW',
    })
  })

  it('P4 only matches as a whole word (P4a is not a priority)', () => {
    const result = parseQuickDispatch('create P4a retire loop', [])
    expect(result.actions[0]).toMatchObject({ priority: 'MEDIUM' })
  })
})
