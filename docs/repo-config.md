# Repository config file (`.lumo.yaml`)

A `.lumo.yaml` at the root of a connected repository configures how Lumo reviews
that repository's pull requests. It is versioned with the code, so a change to
the review settings goes through the same PR review as any other change.

```yaml
# yaml-language-server: $schema=https://<your Lumo host>/schemas/lumo-yaml.schema.json
version: 1
reviews:
  auto_review:
    enabled: true # review every PR automatically
    drafts: false # wait until a draft is marked ready
    base_branches: ['release/.*'] # besides the default branch (regex, full match)
    labels: ['!wip'] # `label` = only PRs with it, `!label` = never PRs with it
    ignore_title_keywords: [WIP, 'DO NOT REVIEW'] # case-insensitive
    ignore_usernames: ['renovate[bot]'] # exact login
    description_keyword: '@review' # with enabled: false, opts a PR in
  path_filters: ['!docs/**', '!**/*.snap'] # what the AI review reads
  pre_merge_checks: # off | warning (default) | error
    title:
      mode: error
      requirements: 'Start with feat:, fix: or chore:'
    description:
      mode: warning # follows the repository's PR template, if any
    issue_assessment:
      mode: warning # linked Lumo task + issues the description closes or links
    custom_checks: # up to 5; replaces the checks set in Lumo
      - name: Changelog # ≤ 50 characters
        mode: warning
        instructions: User-facing changes update CHANGELOG.md. # ≤ 1000
    override_requested_reviewers_only: true # never the PR author
  profile: chill # quiet | chill | assertive — which findings get inline comments
  path_instructions: # extra AI review checks for matching files
    - path: 'scripts/**'
      instructions: Flag any console.log.
tone_instructions: Be concise and friendly. # wording of the AI review and PR answers, ≤250 chars
```

Every key is optional. The keys mean exactly what the same per-repository review
settings mean in Lumo (the settings card and `lumo workspace security-scan
--repo`).

## Review style (`profile`, `path_instructions`, `tone_instructions`)

- `reviews.profile` changes **posting only** — detection, severities, the
  summary's counts and what blocks DONE are the same in every profile:
  - `chill` (default): HIGH and MEDIUM findings get an inline comment; LOW
    ones are one summary line.
  - `quiet`: only HIGH findings get an inline comment; MEDIUM ones are listed
    in a folded block of the summary.
  - `assertive`: LOW findings get an inline comment too.

  In every profile a HIGH finding and a finding that blocks DONE are commented
  inline. The profile in force is stored on the scan, so the comments follow
  the settings the review ran with.

- `reviews.path_instructions` — up to 20 `{ path, instructions }` entries (glob
  ≤200 characters, same syntax as `path_filters`; instructions ≤1,000). Only
  entries whose glob matches a file the AI review reads go into its prompt,
  at most 4,000 characters per review, paid for out of the review's context
  budget (like learnings). They are fenced, guarded prompt text: they add
  checks to the AI review and cannot switch a layer off, approve, clear a
  finding or change what blocks DONE.
- `tone_instructions` (top level, ≤250 characters): how the AI review words its
  finding titles, details and PR description, and how Lumo words its answers to
  questions on the PR. Wording only. Lumo's fixed notes (learning
  acknowledgements, command replies) do not change.

## Precedence

For each key, the first of these that sets it wins:

1. `.lumo.yaml` on the PR's **base** commit;
2. the repository's review settings stored in Lumo;
3. the workspace defaults.

An explicit empty list (`labels: []`) or `null` in the file counts as set: it
overrides the stored setting. A key the file leaves out falls through.
`repoConfigService.effective()` returns every key's value together with where it
came from (`file`, `repository`, `default`). On a PR, comment
`@uselumo configuration` (write access required) to see them — with the
workspace switches — as that PR's review applies them.

Workspace-level switches (scanning on/off, request changes, learnings scope) are
not read from the file. PRs linked to a Lumo task are always scanned whatever
the file says (they are the DONE gate's evidence), and blocking security
findings are only cleared by a disposition in Lumo — never by a config file.

## Pre-merge checks

`reviews.pre_merge_checks` sets the rules each reviewed PR is held to; the
results are a section of the PR's security summary (failures in a table with
the reason and the fix, passes folded). Built-in checks: `title` (concise and
describes the change, plus optional `requirements`) and `description` (filled
in; follows the repository's pull request template when it has one), and
`issue_assessment` (below). Up to five `custom_checks` in plain language.

- `warning` reports a failure. `error` also keeps Lumo's review at "Changes
  requested" while the workspace's request-changes workflow is on (and refuses
  `@uselumo approve`) until the check passes — on a later push, or after the
  title / description is edited — or the PR overrides the checks.
- A check the model cannot decide is **inconclusive**: reported, never
  blocking. A failed model call makes every check inconclusive, except that a
  check that already failed on the same commit stays failed — a transient
  failure never lifts a block.
- Override, per PR: comment `@uselumo ignore pre-merge checks` (write access).
  It is recorded (who, when, head) and shown in the summary, and it covers
  every later push to the PR (the recorded head is for the audit trail); with
  `override_requested_reviewers_only`, only a reviewer requested by name (or
  who already reviewed) may, never the author. An override never clears a
  finding that blocks DONE.
- The checks run with the AI review: one model call per reviewed head, over the
  PR's title, description, template and diff (path filters applied, secrets
  masked before the diff is cut to at most 40,000 characters). The PR's text is treated as untrusted
  data; the rules come only from Lumo's settings or this file on the base
  commit.
- `issue_assessment` (LUM-1149) judges each requirement of the PR's linked Lumo
  task (its Goal and each "Done when" item) and of each issue of the same
  repository its description closes or links (`closes #12`, an issue URL; up
  to three) as Addressed / Not addressed / Unclear. Any Not addressed fails
  the check; otherwise any Unclear makes it inconclusive; with no linked task
  and no linked issue it is not applicable (never a failure). Unmet
  requirements are also flagged in one review comment. On a public repository
  the PR shows only which task item and its outcome — quoting the task there
  is a Lumo setting (`--task-details-on-public-repos`), never a key of this
  file.
- Extension point for a new built-in check: `BUILTIN_PRE_MERGE_CHECKS` in
  `ee/security/security-scan/pre-merge-checks.ts` (its `gather` reads what the
  rule needs beyond the PR).

## Why the base branch

The file is read from the commit the PR's base branch points at, never from the
PR's own branch. Otherwise a PR could weaken its own review: add its title
keyword to `ignore_title_keywords`, exclude its files with `path_filters`, turn
review off, or switch off the pre-merge checks it fails.

A PR that changes `.lumo.yaml` is reviewed with the **current** settings; its
summary says the change applies to reviews after it merges, and reports any
problems in the new file so they can be fixed before merging.

Which keys a PR-branch copy may change is declared per key (`prBranch` in
`REPO_CONFIG_FIELDS`). In version 1 it is none: every key decides whether or
what is reviewed, so a PR-branch copy could only loosen the review or spend the
repository owner's review budget. A future key that a PR may only tighten (for
example, adding a check) can declare its own merge rule there.

## Invalid files

A file is never half-applied and never silently ignored:

- **YAML or schema error** — the whole file is not applied; the review uses the
  Lumo settings, and the PR summary says so with each problem (line and key).
- **Unknown keys** — ignored; the PR summary lists them (a misspelt key is the
  usual cause). An older Lumo reading a newer file therefore degrades to
  "ignored key", not "invalid".
- **File could not be read** (GitHub error) — the review uses the Lumo settings
  and the summary says so; the next review reads it again.

A missing or invalid file never fails a scan.

## Editor support

The JSON schema at `/schemas/lumo-yaml.schema.json` (generated from the Zod
schema) gives completion and validation in editors that read
`yaml-language-server` schema comments.

## Caching

The file is read once per (workspace, repository, base commit sha) per server
instance; a commit's content never changes, so the cache is never stale. A
failed read is not cached.

## Adding a key (for Lumo developers)

1. Add it to `repoConfigSchema` in `ee/security/validation/repo-config.ts`
   (snake_case, `.optional()`, a `.describe()` — editors show it).
2. Register it in `REPO_CONFIG_FIELDS` (`ee/security/security-scan/repo-config.ts`):
   how to read it from the file, the Lumo setting it overrides (if any), its
   default, and its `prBranch` policy. The effective config and its sources pick
   it up from there.
3. Run `npx tsx scripts/security/emit-repo-config-schema.ts` and commit
   `public/schemas/lumo-yaml.schema.json` (a test fails when it drifts).
4. Read the resolved value where the feature runs: the scan gets the base
   commit's file from `repoConfigService.forPullRequest`, the auto-review
   decision from `repoConfigService.fileForDecision`.
