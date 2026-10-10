/**
 * @jest-environment node
 *
 * LUM-1072 — drift guard: the id columns rekey/verify cover are exactly the
 * columns RFC LUM-1069 appendix A command 1 derives from prisma/schema.prisma
 * (+ PriorityOverride.memberId), so a new user-id column cannot be missed.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  columnLabel,
  MENTION_COLUMNS,
  USER_ID_COLUMNS,
} from '@/lib/auth-migration/identity-columns'

/** Port of the appendix A awk command (field name has "clerk", or a `///` doc says "Clerk (user) id"). */
function deriveFromSchema(schema: string): string[] {
  const out: string[] = []
  let model = ''
  let doc = ''
  for (const line of schema.split('\n')) {
    const m = /^model (\w+)/.exec(line)
    if (m) {
      model = m[1]!
      doc = ''
      continue
    }
    if (/^}/.test(line)) {
      model = ''
      continue
    }
    if (!model) continue
    if (/^\s*\/\/\//.test(line)) {
      doc += ` ${line}`
      continue
    }
    if (/^\s*($|\/\/)/.test(line)) continue
    const field = line.trim().split(/\s+/)[0]!
    if (field.startsWith('@@')) {
      doc = ''
      continue
    }
    if (/clerk/i.test(field) || /Clerk (user )?id/.test(doc)) {
      out.push(`${model}.${field}`)
    }
    doc = ''
  }
  return out.sort()
}

describe('LUM-1072 identity columns', () => {
  const schema = readFileSync(
    path.resolve(__dirname, '../../prisma/schema.prisma'),
    'utf8'
  )

  it('covers the 11 schema-derived columns plus PriorityOverride.memberId', () => {
    const derived = deriveFromSchema(schema)
    expect(derived).toHaveLength(11)
    expect(USER_ID_COLUMNS.map(columnLabel).sort()).toEqual(
      [...derived, 'PriorityOverride.memberId'].sort()
    )
  })

  it('every mention column is a text field of an existing model', () => {
    for (const c of MENTION_COLUMNS) {
      const label = columnLabel(c)
      const [model, field] = label.split('.')
      const block = new RegExp(`^model ${model} \\{[\\s\\S]*?^\\}`, 'm').exec(
        schema
      )
      expect(block).not.toBeNull()
      expect(block![0]).toMatch(new RegExp(`^\\s+${field}\\s+String`, 'm'))
    }
  })
})
