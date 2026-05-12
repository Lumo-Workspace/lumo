import type { ProposalOperation } from '@/lib/validation/lumo-proposal.schema'

interface ApplyResult {
  content: string
  warnings: string[]
}

export function applyOperations(
  lumoMd: string,
  operations: ProposalOperation[]
): ApplyResult {
  const warnings: string[] = []
  const lines = lumoMd.split('\n')

  for (const op of operations) {
    const sectionIdx = lines.findIndex(
      l => l.trim().toLowerCase() === `## ${op.section}`.toLowerCase()
    )

    if (op.type === 'add') {
      const bullet = `- ${op.content} <!-- from: ${op.sourceTaskId} -->`

      if (sectionIdx === -1) {
        if (lines.length > 0 && lines[lines.length - 1]!.trim() !== '') {
          lines.push('')
        }
        lines.push(`## ${op.section}`, '', bullet, '')
      } else {
        const insertIdx = findSectionEnd(lines, sectionIdx)
        lines.splice(insertIdx, 0, bullet)
      }
    } else if (op.type === 'modify') {
      if (sectionIdx === -1) {
        warnings.push(
          `Could not find section "## ${op.section}" for modify operation`
        )
        continue
      }
      const { start, end } = getSectionRange(lines, sectionIdx)
      const targetIdx = findBulletContaining(lines, start, end, op.oldContent)
      if (targetIdx === -1) {
        warnings.push(
          `Could not find bullet containing "${op.oldContent}" in ## ${op.section}`
        )
        continue
      }
      lines[targetIdx] = `- ${op.newContent} <!-- from: ${op.sourceTaskId} -->`
    } else if (op.type === 'supersede') {
      if (sectionIdx === -1) {
        warnings.push(
          `Could not find section "## ${op.section}" for supersede operation`
        )
        continue
      }
      const { start, end } = getSectionRange(lines, sectionIdx)
      const targetIdx = findBulletContaining(lines, start, end, op.content)
      if (targetIdx === -1) {
        warnings.push(
          `Could not find bullet containing "${op.content}" in ## ${op.section}`
        )
        continue
      }
      lines.splice(targetIdx, 1)
    }
  }

  return { content: lines.join('\n'), warnings }
}

function findSectionEnd(lines: string[], sectionIdx: number): number {
  let i = sectionIdx + 1
  let lastBullet = -1
  while (i < lines.length) {
    if (lines[i]!.startsWith('## ')) break
    if (lines[i]!.startsWith('- ')) lastBullet = i
    i++
  }
  return lastBullet === -1 ? sectionIdx + 2 : lastBullet + 1
}

function getSectionRange(
  lines: string[],
  sectionIdx: number
): { start: number; end: number } {
  const start = sectionIdx + 1
  let end = lines.length
  for (let i = start; i < lines.length; i++) {
    if (lines[i]!.startsWith('## ')) {
      end = i
      break
    }
  }
  return { start, end }
}

function findBulletContaining(
  lines: string[],
  start: number,
  end: number,
  text: string
): number {
  for (let i = start; i < end; i++) {
    if (lines[i]!.includes(text)) return i
  }
  return -1
}
