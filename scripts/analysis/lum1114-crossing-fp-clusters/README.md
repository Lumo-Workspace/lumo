# LUM-1114 — boundary-crossing false-positive patterns

Read-only. Finds which command / code shapes produce most of the human review
work, so the next detector fix targets the biggest pattern.

```bash
# 1. export (your terminal — needs the prod pooled URL; output stays outside the repo)
DATABASE_URL="$PROD_DATABASE_URL" npx tsx scripts/analysis/lum1114-crossing-fp-clusters/export.ts \
  --out /tmp/lum1114/crossings.json --workspace lumo --team LUM --since 2026-09-13   # default: last 30 days

# 2. report (offline)
npx tsx scripts/analysis/lum1114-crossing-fp-clusters/report.ts --in /tmp/lum1114/crossings.json --top 25
#   --category INFRA_TERMINATION   one category
#   --json                         machine-readable, for before/after diffs
```

- A **pattern** = category + shape (`shape.ts`): the matched segment with
  paths, URLs (`<url:local>` / `<url:public>`), ids, numbers and quoted text
  folded. `PROJECT_RULE_VIOLATION` is also split per rule.
- Labels are the crossing's current state: `FP` / `CONFIRMED` (human),
  `AUTO` (AUTO_LEGIT triage or AUTO_SUPPRESSED rule), `OPEN` (no ruling yet).
  `FP%` = FP ÷ (FP + CONFIRMED), the same denominator as
  `scripts/boundary-fp-rate.ts`.
- Sorted by human FP count, then OPEN rows — the review a human still owes.
- One tenant per export: `--workspace <slug>` is required and must resolve to
  exactly one workspace (slugs and team ids are not unique across tenants);
  `--team` narrows inside it. Other workspaces' crossings
  are customer data: `--all-tenants` exists for an explicit, justified
  cross-tenant read only. Findings from one tenant (e.g. our own dogfooding)
  are not evidence about customers — a fix must be generic, never keyed to
  one tenant's repo, paths or CLAUDE.md wording.
- Every exported text is re-redacted and capped at 500 chars; never commit the
  export.
