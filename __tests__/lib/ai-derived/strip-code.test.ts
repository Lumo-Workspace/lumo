import {
  CODE_OMITTED_MARKER,
  DERIVED_CONTENT_NO_CODE_RULE,
  MAX_INLINE_CODE_CHARS,
  isCodeLikeLine,
  stripCodeFromJson,
  stripCodeFromStoredFields,
  stripCodeFromText,
} from '@/lib/ai-derived/strip-code'

const FENCE = '```'

describe('stripCodeFromText (LUM-917)', () => {
  it('replaces a fenced code block with one marker', () => {
    const input = [
      'The retry loop never backed off.',
      `${FENCE}ts`,
      'for (let i = 0; i < 3; i++) {',
      '  await callApi()',
      '}',
      FENCE,
      'Fixed by adding a delay.',
    ].join('\n')
    const out = stripCodeFromText(input)
    expect(out.removed).toBe(1)
    expect(out.text).toBe(
      [
        'The retry loop never backed off.',
        CODE_OMITTED_MARKER,
        'Fixed by adding a delay.',
      ].join('\n')
    )
    expect(out.text).not.toContain(FENCE)
    expect(out.text).not.toContain('callApi')
  })

  it('catches a fence opened after prose on the same line', () => {
    const out = stripCodeFromText(`Added ${FENCE}ts\nload(id)\n${FENCE}\nDone.`)
    expect(out.text).toBe(`Added\n${CODE_OMITTED_MARKER}\nDone.`)
  })

  it('drops an unclosed fence through the end of the text', () => {
    const out = stripCodeFromText(`Summary.\n~~~\nconst a = 1\nconst b = 2`)
    expect(out.text).toBe(`Summary.\n${CODE_OMITTED_MARKER}`)
  })

  it('collapses a run of bare code lines (blank lines inside) into one marker', () => {
    const input = [
      'Root cause: the import was wrong.',
      "import { prisma } from '@/lib/db/prisma'",
      '',
      'export async function load(id: string) {',
      '  return prisma.task.findUnique({ where: { id } });',
      '}',
      'Use the repository instead.',
    ].join('\n')
    const out = stripCodeFromText(input)
    expect(out.removed).toBe(1)
    expect(out.text).toBe(
      [
        'Root cause: the import was wrong.',
        CODE_OMITTED_MARKER,
        'Use the repository instead.',
      ].join('\n')
    )
  })

  it('keeps prose, file paths and short inline commands untouched (same value)', () => {
    const prose = [
      'Run `npm run i18n:sync` after editing lib/i18n/en.json.',
      'Prisma rejects the migration with P3012; resolve it with migrate resolve.',
      'If the dev DB drifts, hand-write the SQL.',
      '- Use the `useRetentionSave` hook for each row.',
      '会话结束后再提炼记忆,不要在 render 里调用 new Date()。',
    ].join('\n')
    const out = stripCodeFromText(prose)
    expect(out.removed).toBe(0)
    expect(out.text).toBe(prose)
  })

  it('replaces an inline code span longer than the cap', () => {
    const long = 'x'.repeat(MAX_INLINE_CODE_CHARS + 1)
    const out = stripCodeFromText(`See \`${long}\` and \`short()\`.`)
    expect(out.text).toBe(`See ${CODE_OMITTED_MARKER} and \`short()\`.`)
    expect(out.removed).toBe(1)
  })

  it('treats a long minified line as code', () => {
    const minified = 'function(a){return a.map(b=>b*2).filter(c=>c>1)};'.repeat(
      5
    )
    expect(stripCodeFromText(`Bundle:\n${minified}`).text).toBe(
      `Bundle:\n${CODE_OMITTED_MARKER}`
    )
  })
})

describe('isCodeLikeLine (LUM-917)', () => {
  it.each([
    "import fs from 'node:fs'",
    'from os import path',
    'const total = items.length',
    'def handler(event):',
    'if (user == null) {',
    'return res.status(500).json(err);',
    '});',
    '#include <stdio.h>',
    '<Button variant="ghost" />',
    'foo.bar(baz);',
  ])('flags %s', line => {
    expect(isCodeLikeLine(line)).toBe(true)
  })

  it.each([
    'Run the migration before deploying.',
    'The import failed because the path was wrong.',
    'Use const for values that never change.',
    'lib/services/run-summary.service.ts',
    'npx prisma migrate resolve --applied 20261006_x',
    '',
  ])('keeps %s', line => {
    expect(isCodeLikeLine(line)).toBe(false)
  })
})

describe('stripCodeFromJson / stripCodeFromStoredFields (LUM-917)', () => {
  it('strips nested strings and returns the same reference when clean', () => {
    const clean = { trigger: 'A', steps: ['b', 'c'] }
    expect(stripCodeFromJson(clean).value).toBe(clean)

    const dirty = {
      trigger: 'When saving',
      steps: ['Call the hook', `${FENCE}\nsave()\n${FENCE}`],
    }
    const out = stripCodeFromJson(dirty)
    expect(out.removed).toBe(1)
    expect(out.value).toEqual({
      trigger: 'When saving',
      steps: ['Call the hook', CODE_OMITTED_MARKER],
    })
    // the caller's object is not mutated
    expect(dirty.steps[1]).toContain('save()')
  })

  it('only touches the listed fields', () => {
    const data = { content: `${FENCE}\nx()\n${FENCE}`, title: 'const a = 1' }
    const out = stripCodeFromStoredFields(data, ['content'])
    expect(out).toEqual({ content: CODE_OMITTED_MARKER, title: 'const a = 1' })
    expect(stripCodeFromStoredFields({ title: 'ok' }, ['content'])).toEqual({
      title: 'ok',
    })
  })

  it('passes non-plain values (Prisma sentinels) through', () => {
    class Sentinel {}
    const s = new Sentinel()
    expect(stripCodeFromJson(s).value).toBe(s)
  })
})

describe('DERIVED_CONTENT_NO_CODE_RULE', () => {
  it('forbids code in the generated output', () => {
    expect(DERIVED_CONTENT_NO_CODE_RULE).toMatch(/never copy source code/)
  })
})
