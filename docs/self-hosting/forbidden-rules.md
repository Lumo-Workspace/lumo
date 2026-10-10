# Removed `## Forbidden` rules (POLICY_WEAKENING)

Lumo records a **POLICY_WEAKENING** boundary crossing when a rule disappears
from the `## Forbidden` section of a project's `CLAUDE.md` or `AGENTS.md`.
This check is part of the open core: it parses the files directly and calls no
model, so it works on a self-hosted server without the security plugin.

## What it needs

- The GitHub App ([integrations.md](integrations.md#github-app)) installed on
  the repository, and the repository linked to the project. The default
  repository of the project is read (its default branch).
- Agent sessions bound to the project's tasks: the check runs on their hook
  events. Each file is read at most once a minute per project and server
  instance.

The first look at a project only stores its rules. From then on, every change
of the files is compared with the stored rules (table
`forbidden_rule_snapshots`).

## What is recorded

| Change                                                                                                                                                              | Crossing          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| A rule line is deleted, or its wording changed (the old wording is gone from both files)                                                                            | HIGH, blocks DONE |
| A rule is still in the file but no longer a rule: moved to another section, struck through (`~~…~~`), commented out (`<!-- … -->`), or the heading stopped matching | MEDIUM, advisory  |
| Formatting only: list marker, line wrapping, order, case, backticks / `*`, trailing punctuation                                                                     | nothing           |
| A rule moved between `CLAUDE.md` and `AGENTS.md`, a rule added, other sections edited                                                                               | nothing           |

The crossing is attached to the task whose hook event first sees the change.
If the rule's text comes back later, the open HIGH crossing is re-judged to
advisory (on the next observed change, or by the hourly `rejudge-crossings`
cron).

With the security plugin installed, its model-compiled policy reports the same
deletions. One deletion is still one crossing: whichever source sees it second
skips a rule that an open (not yet ruled on) POLICY_WEAKENING crossing of the
project from the other source already names, on the same side of HIGH /
advisory. Once that crossing is ruled on, a later deletion is recorded again.

## The format that is recognised

Anything outside this format is ignored. A file the parser cannot read misses
a removal; it never invents one.

```markdown
## Forbidden

- Never delete files in prisma/migrations/
- Never push to main or develop directly
  (a continuation line belongs to the rule above)

1. Ordered items work too
```

- **Section**: a level-2 heading (`## `) whose title starts with the word
  `Forbidden`, in any case (`## Forbidden`, `## Forbidden actions`).
  `# Forbidden`, `### Forbidden`, underlined (setext) headings and translated
  titles are not recognised.
- **End of the section**: the next `#` or `##` heading, or a thematic break
  (`---`, `***`, `___`). `###` sub-headings inside it do not end it.
- **Rule**: a top-level list item (`-`, `*`, `+`, `1.`, `1)`, indented at most
  three spaces). Its text includes indented continuation lines, nested items
  and lines that directly follow it; a blank line ends it.
- **Ignored inside the section**: paragraphs, table rows, fenced code blocks
  (` ``` ` / `~~~`), HTML comments, and items whose whole text is struck
  through.
- Several `## Forbidden` sections, in one file or in both, form one rule set.

## Not covered

- Deleting **both** `CLAUDE.md` and `AGENTS.md` (or losing access to the
  repository) records nothing: an unreadable repository looks the same.
- Rules outside a `## Forbidden` section (for example "Never …" lines in
  other sections) are not tracked.
- Changes on branches other than the default branch are seen only once they
  are merged.
