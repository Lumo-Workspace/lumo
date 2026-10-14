/**
 * LUM-1114 — READ-ONLY. For ONE tenant's projects, how many rules of the
 * active compiled policy no detector ever checks (rule-reachability).
 * findMany only, no writes, no model calls.
 *
 *   DATABASE_URL='<prod pooled url>' npx tsx \
 *     scripts/analysis/lum1114-dead-rules/count.ts --workspace lumo --team LUM
 *
 * Tenant-scoped: `--workspace <slug>` must resolve to exactly one workspace
 * (slugs are not unique in the schema — an ambiguous slug aborts), and the
 * team is looked up inside it. Prints counts plus each UNCHECKED rule's text —
 * that tenant's own CLAUDE.md lines, nobody else's.
 */
import {
  BUILTIN_CATEGORIES,
  compileRuleSet,
} from '@/ee/security/services/policy/policy-compiler.service'
import {
  ruleReach,
  type RuleReach,
} from '@/ee/security/services/policy/rule-reachability'
import type { PolicyRule } from '@/lib/policy/types'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const slug = flag('--workspace')
  const team = flag('--team')
  if (!slug || !team)
    throw new Error('--workspace <slug> and --team <identifier> are required')

  const { prisma } = await import('@/lib/db/prisma')
  const host = new URL(process.env.DATABASE_URL ?? 'postgres://unset').host
  const workspaces = await prisma.workspace.findMany({
    where: { slug },
    select: { id: true, name: true },
  })
  if (workspaces.length !== 1)
    throw new Error(
      `--workspace ${slug} matches ${workspaces.length} workspaces — refusing (tenant must be unambiguous)`
    )
  const ws = workspaces[0]!
  process.stdout.write(
    `[read-only] LUM-1114 dead rules · db ${host} · workspace ${ws.name} (${ws.id}) · team ${team}\n`
  )

  const projects = await prisma.project.findMany({
    where: { workspaceId: ws.id, team: { identifier: team } },
    select: { id: true, name: true },
  })
  const builtins = new Set<string>(BUILTIN_CATEGORIES)
  for (const project of projects) {
    const latest = await prisma.projectPolicy.findFirst({
      where: { projectId: project.id },
      orderBy: { compiledAt: 'desc' },
      select: { compiledAt: true, rules: true },
    })
    if (!latest) {
      process.stdout.write(`\n${project.name}: no compiled policy\n`)
      continue
    }
    const stored = latest.rules as unknown as PolicyRule[]
    const tally = (rules: PolicyRule[]) => {
      const t: Partial<Record<RuleReach, number>> = {}
      for (const r of rules) {
        const k = ruleReach(r, builtins)
        t[k] = (t[k] ?? 0) + 1
      }
      return t
    }
    // The stored rules as they run today, and the same rules through the
    // current compileRuleSet (what the next recompile's post-processing does
    // to them — no model call).
    const now = tally(stored)
    const after = tally(compileRuleSet(stored))
    process.stdout.write(
      `\n${project.name}: policy compiled ${latest.compiledAt.toISOString()} · ${stored.length} rules\n` +
        `  as stored:            ${JSON.stringify(now)}\n` +
        `  after compileRuleSet: ${JSON.stringify(after)}\n`
    )
    for (const r of stored) {
      if (ruleReach(r, builtins) !== 'unchecked') continue
      process.stdout.write(
        `  UNCHECKED ${r.kind}/${r.tier}${r.predicate ? `+${r.predicate.type}` : ''}${r.assertion ? '+assertion' : ''} · ${r.text.slice(0, 120)}\n`
      )
    }
  }
  await prisma.$disconnect()
}

main().catch(err => {
  process.stderr.write(`lum1114 dead rules: ${(err as Error).message}\n`)
  process.exit(1)
})
