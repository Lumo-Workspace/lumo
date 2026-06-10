/**
 * Minimal line-based unified diff (LUM-408, `lumo doc diff`).
 *
 * Pure and dependency-free: the CLI ships only commander + markdown-it, and
 * shelling out to system `diff` would not be portable. Equality (the exit
 * code) is decided on raw bytes by the caller — this renderer only has to
 * make the divergence readable, so a plain LCS with a size guard is enough.
 */

interface DiffOp {
  type: 'ctx' | 'del' | 'add'
  text: string
}

const CONTEXT_LINES = 3
/** Above this old×new line product the LCS table is too big — degrade to a single whole-block hunk. */
const MAX_LCS_CELLS = 4_000_000

function splitLines(text: string): string[] {
  return text.split('\n')
}

/** LCS-based op list for the (already prefix/suffix-trimmed) middle section. */
function diffOps(oldLines: string[], newLines: string[]): DiffOp[] {
  const n = oldLines.length
  const m = newLines.length
  if (n * m > MAX_LCS_CELLS) {
    return [
      ...oldLines.map(text => ({ type: 'del' as const, text })),
      ...newLines.map(text => ({ type: 'add' as const, text })),
    ]
  }
  // lcs[i][j] = LCS length of oldLines[i:] vs newLines[j:]
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  )
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        oldLines[i] === newLines[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'ctx', text: oldLines[i]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ type: 'del', text: oldLines[i]! })
      i++
    } else {
      ops.push({ type: 'add', text: newLines[j]! })
      j++
    }
  }
  while (i < n) ops.push({ type: 'del', text: oldLines[i++]! })
  while (j < m) ops.push({ type: 'add', text: newLines[j++]! })
  return ops
}

/**
 * Render a unified diff between two texts. Returns '' when the line
 * sequences are identical (callers decide byte-equality separately —
 * e.g. a trailing-newline-only difference still flips the exit code).
 */
export function formatUnifiedDiff(
  oldText: string,
  newText: string,
  oldLabel: string,
  newLabel: string
): string {
  const oldAll = splitLines(oldText)
  const newAll = splitLines(newText)

  // Trim the common prefix/suffix so the LCS only sees the changed middle.
  let prefix = 0
  while (
    prefix < oldAll.length &&
    prefix < newAll.length &&
    oldAll[prefix] === newAll[prefix]
  ) {
    prefix++
  }
  let suffix = 0
  while (
    suffix < oldAll.length - prefix &&
    suffix < newAll.length - prefix &&
    oldAll[oldAll.length - 1 - suffix] === newAll[newAll.length - 1 - suffix]
  ) {
    suffix++
  }

  const middleOps = diffOps(
    oldAll.slice(prefix, oldAll.length - suffix),
    newAll.slice(prefix, newAll.length - suffix)
  )
  if (!middleOps.some(op => op.type !== 'ctx')) return ''

  // Re-attach trimmed context so hunks can carry CONTEXT_LINES around edits.
  const ops: DiffOp[] = [
    ...oldAll.slice(0, prefix).map(text => ({ type: 'ctx' as const, text })),
    ...middleOps,
    ...oldAll
      .slice(oldAll.length - suffix)
      .map(text => ({ type: 'ctx' as const, text })),
  ]

  // Group ops into hunks: a change plus up to CONTEXT_LINES of context on
  // each side; nearby changes merge into one hunk.
  const lines: string[] = [`--- ${oldLabel}`, `+++ ${newLabel}`]
  let oldLineNo = 1
  let newLineNo = 1
  let idx = 0
  while (idx < ops.length) {
    if (ops[idx]!.type === 'ctx') {
      oldLineNo++
      newLineNo++
      idx++
      continue
    }
    // Found a change — open a hunk starting CONTEXT_LINES back.
    let hunkStart = idx
    let ctxBack = 0
    while (hunkStart > 0 && ops[hunkStart - 1]!.type === 'ctx' && ctxBack < CONTEXT_LINES) {
      hunkStart--
      ctxBack++
    }
    // Extend forward: include changes separated by ≤ 2×CONTEXT_LINES context.
    let hunkEnd = idx
    let scan = idx
    while (scan < ops.length) {
      if (ops[scan]!.type !== 'ctx') {
        hunkEnd = scan
        scan++
        continue
      }
      let run = 0
      while (scan + run < ops.length && ops[scan + run]!.type === 'ctx') run++
      if (scan + run < ops.length && run <= CONTEXT_LINES * 2) {
        scan += run
        continue
      }
      break
    }
    const tail = Math.min(hunkEnd + CONTEXT_LINES, ops.length - 1)
    const hunkOps = ops.slice(hunkStart, tail + 1)

    const oldStart = oldLineNo - ctxBack
    const newStart = newLineNo - ctxBack
    const oldCount = hunkOps.filter(o => o.type !== 'add').length
    const newCount = hunkOps.filter(o => o.type !== 'del').length
    lines.push(
      `@@ -${oldStart}${oldCount === 1 ? '' : `,${oldCount}`} +${newStart}${newCount === 1 ? '' : `,${newCount}`} @@`
    )
    for (const op of hunkOps) {
      const marker = op.type === 'ctx' ? ' ' : op.type === 'del' ? '-' : '+'
      lines.push(`${marker}${op.text}`)
    }
    // Advance the line counters across everything the hunk consumed.
    for (let k = idx; k <= tail; k++) {
      const t = ops[k]!.type
      if (t !== 'add') oldLineNo++
      if (t !== 'del') newLineNo++
    }
    idx = tail + 1
  }
  return lines.join('\n')
}
