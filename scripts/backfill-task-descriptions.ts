/**
 * One-shot script to recover task descriptions that were stored as a
 * single <p> wrapping still-markdown text. Run with --apply to write;
 * default is dry-run.
 *
 * Authorization is required before --apply against prod (same gate as
 * `prisma migrate deploy`).
 */
import { markdownToHtml, isMarkdown } from '@/lib/utils/markdown'
import { BLOCK_TAGS, tagGroup } from '@/lib/utils/html-tags'
import { prisma } from '@/lib/db/prisma'

const SINGLE_P = /^\s*<p>([\s\S]+)<\/p>\s*$/i
// Shared block-level core + `li`: detects whether the unwrapped inner body
// already contains a nested block tag (meaning it was real structural HTML,
// not still-markdown). Derived from the single tag-vocabulary source.
const NESTED_BLOCK = new RegExp(`<(${tagGroup(...BLOCK_TAGS, 'li')})\\b`, 'i')

export function shouldBackfill(html: string | null): boolean {
  if (!html) return false
  const single = SINGLE_P.exec(html)
  if (!single) return false
  const inner = single[1] ?? ''
  if (NESTED_BLOCK.test(inner)) return false
  return isMarkdown(inner)
}

export function rebuild(html: string): string {
  const match = SINGLE_P.exec(html)
  if (!match) return html
  const decoded = (match[1] ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  return markdownToHtml(decoded)
}

async function main() {
  const apply = process.argv.includes('--apply')
  const mode = apply ? 'APPLY' : 'DRY-RUN'
  // eslint-disable-next-line no-console
  console.log(`Mode: ${mode}`)

  const tasks = await prisma.task.findMany({
    select: {
      id: true,
      number: true,
      description: true,
      team: { select: { identifier: true } },
    },
  })

  const hits: Array<{
    id: string
    identifier: string
    before: string
    after: string
  }> = []
  for (const t of tasks) {
    if (!shouldBackfill(t.description)) continue
    hits.push({
      id: t.id,
      identifier: `${t.team.identifier}-${t.number}`,
      before: t.description!,
      after: rebuild(t.description!),
    })
  }

  // eslint-disable-next-line no-console
  console.log(`Matched: ${hits.length} / ${tasks.length}`)

  // Print up to 5 sample diffs so a human can sanity-check before --apply.
  for (const h of hits.slice(0, 5)) {
    // eslint-disable-next-line no-console
    console.log(`\n--- ${h.identifier} ---`)
    // eslint-disable-next-line no-console
    console.log('BEFORE:', h.before.slice(0, 200))
    // eslint-disable-next-line no-console
    console.log('AFTER :', h.after.slice(0, 200))
  }

  if (!apply) {
    // eslint-disable-next-line no-console
    console.log('\nRe-run with --apply to write changes.')
    return
  }

  let ok = 0
  const failed: string[] = []
  for (const h of hits) {
    try {
      await prisma.task.update({
        where: { id: h.id },
        data: { description: h.after },
      })
      // eslint-disable-next-line no-console
      console.log(`Updated ${h.identifier}`)
      ok++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failed.push(`${h.identifier}: ${msg}`)
    }
  }
  // eslint-disable-next-line no-console
  console.log(
    `\nDone. Updated ${ok}. Skipped ${tasks.length - hits.length} (no marker / already structured). Failed ${failed.length}.`
  )
  for (const f of failed) {
    // eslint-disable-next-line no-console
    console.error(`  ${f}`)
  }
}

if (require.main === module) {
  main()
    .catch(err => {
      // eslint-disable-next-line no-console
      console.error(err)
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}
