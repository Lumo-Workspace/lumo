# LUMO.md
<!-- Auto-maintained by Lumo. Do not edit manually. -->

## Traps

- If a user clicks Sync to LUMO.md twice in quick succession, duplicate proposals may be generated and applied, creating conflicting PRs. Before applying a proposal, verify its status is PENDING and reject if already applied; disable the Sync button on the frontend after successful sync. <!-- from: LUM-36 -->
- The LUMO.md proposal LLM may produce entries for information already inferable from code or specs, cluttering LUMO.md with noise. Enforce the 3–6 entry limit per task and merge related memories into single entries during generation to maintain signal quality. <!-- from: LUM-36 -->
## Decisions

- LUMO.md is auto-generated from Layer 1 task memory (TRAP, DECISION, CONVENTION, PROCEDURAL categories) only, without incorporating project metadata or sprint goals. This narrow scope establishes a clear contract between what agents record and what appears in LUMO.md, avoiding complexity of reconciling multiple independent sources. <!-- from: LUM-36 -->
- LUMO.md proposals operate at entry granularity (one operation per memory entry) rather than section-level or free-text rewrites. This enables precise traceability—every change maps back to the exact memory row that generated it—and makes merge/deduplication logic straightforward. <!-- from: LUM-36 -->
- LUMO.md uses structured YAML frontmatter metadata on each entry (e.g. source task ID) rather than pure Markdown, enabling programmatic parsing and entry-level operations without fragile LLM-based diffing of natural-language structure. <!-- from: LUM-36 -->
- The LUMO.md sync flow uses a two-call API: POST /api/tasks/[id]/lumo-proposals generates and previews the proposal, then POST /api/lumo-proposals/[proposalId]/sync applies it and creates the PR. This decouples generation from application, allowing preview before Git changes occur. <!-- from: LUM-36 -->
## Conventions

- System prompts and user prompts for LLM calls must be written in English, while generated LUMO.md entry content reflects the project's own language. This ensures stable LLM reasoning and structured output quality regardless of the project's language. <!-- from: LUM-36 -->
- Task-scoped API endpoints use [id] as the route parameter (not [taskId]), following existing project patterns. New task-related endpoints must follow this convention. <!-- from: LUM-36 -->
- Every LUMO.md memory entry must capture knowledge not deducible from the codebase, specifications, or existing documentation. Limit 3–6 entries per task; merge related memories into single entries; write 1–2 sentences max. <!-- from: LUM-36 -->
## Procedures
