# lumo task status / task wrapup — self-check, crossings, DONE

## lumo task status — the self-check entry point

`lumo task status [task] [--full] [--json]` is a pure read: milliseconds, no
LLM, never writes. Defaults to the session-bound task; an explicit identifier
overrides.

```bash
lumo task status            # session-bound task (next actions / scan coverage / open crossings)
lumo task status LUM-42     # explicit task
lumo task status --full     # + cost, struggle/rework trail, trend, test cases
lumo task status --json     # versioned machine-readable payload
```

### State-changing commands already print it (LUM-842) — no follow-up `task status`

`lumo task update --status …`, `lumo crossing disposition` (the ruling step),
`lumo crossing explain`, `lumo task testcase run` and `lumo task testcase
disposition` (the ruling step) end their output with a short digest read from
the **same** `GET …/status` + open-crossings reads as this command:

```
Status now (same read as `lumo task status LUM-42`; no need to run it again):
  LUM-42 IN_PROGRESS
  Blocks DONE: 1 boundary crossing (LUM-X12) — the user rules
```

The `task update --status done` exit-4 envelope and exit-5 `DONE_BLOCKED` error
carry the same lines as an additive `statusSummary` field (JSON stays
parseable). So there is **no follow-up `lumo task status`** after those commands —
read the digest. It fails closed: `⚠ Could not read / Could not confirm …` means
unknown, never clear, and `Blocks DONE: nothing on record` appears only when
every read behind it succeeded.

### When to run it

**Status-first recovery:** run it FIRST — before re-reading code or planning —
whenever you resume a task in a new session (yours or another agent's earlier
work), or were told the task bounced in review. It answers "what still stands
between this task and DONE": undispositioned security findings, test-case
signals, unscanned PRs, open boundary crossings.

### What it prints

- **Layout (LUM-1091, shared with `task wrapup` / `pr scan`)** — each section is a blank line plus a plain heading (`Next actions (…)`, `Security scans`, `Open boundary crossings (…)`, `Cost`, …; bold on a TTY), facts are `Label:  value` rows under it (a value too long for the line moves under its label), at most three indent levels (2/4/6 spaces), prose wrapped at 100 columns, and every shell command on a line of its own. Colour (bold headings, dim labels) only on a TTY without `NO_COLOR`; piped/agent output is plain text.
- **Header** — task identifier/title and `Status: <STATUS>`.
- **Done gate (LUM-1186)** — first section, the **same verdict as the web Record tab's Done gate** (computed server-side by the shared `deriveDoneGate`; the CLI only renders it): `Done gate: BLOCKED — N items block DONE` | `READY — nothing blocks DONE` | `ACCEPTED — the task is DONE`, then three rows — `Crossings:` (`– none recorded` · `✗ N blocking, not dispositioned` · `✓ N advisory (open, does not block DONE)` · `dispositioned D/T`), `Security:` (`✗ N blocking findings not dispositioned` · `✓ no blocking findings` · `– not scanned … — not a clean result`; no row when the server has no security check) and `Tests:` (`✗ N proven defects awaiting a ruling` · `✓ no proven defects` + `P/T passing` · `– no test cases`). `✗` blocks, `✓` clear, `–` nothing to check. Fails closed: `Done gate: ⚠ CANNOT CONFIRM — could not read <plane>` (or an older server without the gate) means unknown, never ready.
- **Default = the self-check core (LUM-733):** header, Done gate, Next actions, scan coverage, Open boundary crossings. The dashboard sections (**Cost**, **Struggle / rework**, **Trend**, **Test cases**) print only with `--full`.
- **Cost** (`--full`) — **Tokens** (total across the task's sessions) and **Active time** (non-idle agent seconds — Σ per-turn `STOP − prompt`), read from the same server-side source as the web delivery card (`retrospectiveRepository.loadActuals`), so the two cannot drift. Fail-closed: no recorded session usage prints `Tokens:  not recorded (no session usage captured)`, distinct from a measured `0`.
- **Struggle / rework** (`--full`) — always printed so a clean-looking task still shows its scars: **PR iterations** when the task has >1 PR (a single PR is the happy path), and **Reopened** (`N×`, one `FROM → TO` line per reopen under it) — backward `IN_REVIEW/DONE → IN_PROGRESS/TODO` transitions from the `STATUS_CHANGED` log. Empty trail states its basis (`None recorded — 1 PR, no reopens.`).
- **Trend** (`--full`) — rows `Cost/session:  4.2K → 1.1K tokens (↓)`, `Total:  5.3K tokens over 2 sessions` (summing to the Cost total) and `Rework:  2 accrued — 1 reopen, +1 PR cycle (↑ from 0)`. One session is one data point: it prints `Single attempt so far — no trajectory yet` rather than a fake arrow.
- **Test cases** (`--full`, LUM-1186) — one line per case, the same row `lumo task testcase list` prints (same `GET …/test-cases` read, same formatter): `TC<n>`, the sanitized title, `<s> steps / <v> verify` (`· Only proves on <ENV>` when pinned), then the latest run — `<RESULT> on <ENV>[ → <ceiling>] [@sha] (<date>)`, e.g. `PASS on LOCAL → UNPROVEN (no evidence)`, with ` · cause: defect|outdated|external`, ` · ruled KNOWN_DEFECT|NOT_A_DEFECT` and the step progress (`2 of 3 steps passed` / `failed at step 2`) — or `never run`. The section ends with the server-computed `N/M passing · F failing · U unproven/blocked · R never run` line. Read only with `--full` (the default report makes no extra request); no cases prints `None recorded.`; a failed read prints `⚠ could not read test cases (<reason>) — retry with: lumo task testcase list <task>` and never fails the whole status. `--json` is unchanged (no `testCases` field — use `lumo task testcase list` for that data).
- **Next actions** — undispositioned **PR security findings** (LUM-737) first, one item each — `• [SECURITY] [SEVERITY] <title>` with the rows `Rule:  <ruleId> (<PROVENANCE>)`, `Where:  <file:line> · PR #n` and `Gate:  blocks DONE | advisory[ — <cause>, downgraded]`; findings the agentic verifier rejected (LUM-988) are not listed — read them with `lumo pr scan`; a non-security finding from the AI code review (rule id `review:<kind>`, kind CORRECTNESS — a logic bug, error handling, a doc mismatch, a test that cannot catch its bug) is tagged `• [BUG]` instead of `• [SECURITY]` and is always `advisory` (LLM findings never block DONE); the heading splits the count when any are present (`Next actions (1 security finding · 2 bugs)`); then the test-case rows (`• [TEST CASE] …` — no test case recorded yet (`… (advisory) — run:` with the command on the next line), or a run's verdict signal; see [test-cases.md](test-cases.md)). A verdict row ends with what the DONE gate does with it: a proven defect whose latest run nobody has ruled on is `(blocks DONE until the user rules on it)` — the server refuses DONE with 409 on it (`lib/acceptance/done-verdict.ts`, TEST_CASE_DEFECT blocker); once ruled on it is `(ruled on — does not block DONE)`; UNPROVEN / out-of-date rows are `(advisory)`. The heading reads `Next actions (advisory only)` only when nothing listed can hold DONE. A finding is fixed by pushing (a fixed fingerprint disappears from the next scan) or dispositioned by a human in the web delivery panel — there is no CLI path to clear one, and a `blocks DONE` finding refuses DONE with 409. The trailing **downgrade cause** appears only on deterministic `secret:*` rows lowered to LOW (`placeholder value` / `test/fixture/doc path`); downgrading is not suppression. Nothing outstanding prints `Next actions` / `None on record.`
  - **Per-PR scan status** (LUM-735), under a `Security scans` heading: a `PR #945 · scan CLEAN` line per linked PR with a latest scan, then one row per layer (`Secrets:  checked`, `Code scan:  checked (2 external findings)`, `Dependencies:  checked`, `AI review:  checked`, `Exploit paths:  ⚠ partly checked`) and `Note:` / `Queue:` rows for the scan-wide notes. Stage display labels are shared with the GitHub PR summary (`shared/src/security-scan.ts`); full layer grammar, size-cap lines, turned-off lines and the hunt coverage table are documented in [pr-scan.md](pr-scan.md) — `task status` uses the same formatter.
  - **Queue exit / persisting findings** (LUM-775 / LUM-738): rows that left the queue on merge/close, and findings already on the default-branch baseline, are not next actions and are not counted.
  - **Fails closed:** `⚠ Security-scan check failed — could not confirm …` when the scan read errored, and one `⚠ PR #n: … — could not confirm it is clean.` line per open PR whose latest scan is missing / failed / running, or whose workspace turned scanning off. A PR too large to scan (LUM-1079, `unconfirmedPrs[].reason: TOO_LARGE`) says `the PR is too large to scan, so nothing in it was scanned (split it or narrow its scope to get it scanned)` — see [pr-scan.md](pr-scan.md); its scan line reads `scan not scanned — PR too large` with the reason line under it. Silence means a successful read with nothing open.
- **Open boundary crossings** — a trailing block when the task has ≥1 OPEN crossing: `(N undispositioned: B blocking DONE, A advisory / non-blocking)` (LUM-771), then one item per crossing — `• <ref> [SEVERITY] CATEGORY (blocks DONE | advisory — does not block DONE | below the workspace gate — does not block DONE)` — with rows `Re-judged:  <evidence>` (a re-judged advisory row only), `Detail:  <first line>` and `By:  model=<m> · agent=<type>[/branch] · session=<8-char prefix>` (`unknown` when unresolved, never fabricated), then the `lumo crossing disposition <id> --false-positive | --confirmed` pointer and the web panel URL, each on its own line. Read-only awareness: it clears nothing. A failed crossings read prints `⚠ Boundary-crossing check failed …` instead of staying silent.

### --json contract

`--json` emits the read model with a top-level `version` field (currently `2`;
LUM-942 removed the acceptance-criteria / verification-round fields). Breaking
shape changes bump it; additive fields don't. Pin on `version` when scripting.

- `doneGate` (LUM-1186) — `{ confirmed: true, headline: 'blocked'|'ready'|'accepted', blockingTotal, crossings { state: 'blocked'|'advisory'|'clear'|'none', blocking, advisory, dispositioned, total }, security { state: 'blocked'|'clear'|'notScanned', blocking } | null, tests { state: 'blocked'|'clear'|'none', blocking, passing, total } }`, or **`{ confirmed: false, unconfirmed: [<plane>…] }` when a plane could not be read** — treat as "could not confirm"; `security: null` = the server has no security check;
- `task { id, identifier, title, status }`, `cost { tokenCost, activeTimeSec }` (`tokenCost: null` = not measured), `struggleTrail { pullRequests[], reopens[] }`, `trend { cost[], rework { reopens, extraPrCycles, total } }`, `claim`, `faithfulness` (JSON-only — the text report does not print a Claim section);
- `nextActions` entries carry a `kind` discriminator: `SECURITY_FINDING` (`findingId`, `statement`, `severity`, `provenance`, `blocking`, `prNumber`, `ruleId`, `filePath`, `line`), `TEST_CASE` (`statement`, `command`, `advisory: true`) or `TEST_CASE_VERDICT` (`signal`, `number`, `title`, `ceilingReason?`, `blocking`, `advisory`). `TEST_CASE_VERDICT.blocking` is `true` exactly for a `PROVEN_DEFECT` whose latest run is not ruled on (it refuses DONE), and `advisory` is always `!blocking`; `TEST_CASE` rows are always advisory;
- `securityFindings { open, blocking, unconfirmedPrs[], scans?[] }` — **`null` means the scan read failed**: treat as "could not confirm", not "safe";
- a finding whose Lumo review thread a human **resolved on GitHub** (LUM-1127) leaves `SECURITY_FINDING` and `open` only when it is **not** blocking; a blocking one stays (`blocking: true`) and still holds DONE until it is dispositioned in Lumo — resolving a conversation is not a disposition;
- open boundary crossings ride along as an additive top-level `openCrossings` (`{ id, ref, category, severity, detail, attribution }` — `ref` is the `<TEAM>-X<n>` to show and type, `id` the cuid); **`null` when the crossings check failed**, distinct from `[]`.

## Every crossing in full — `lumo crossing list` (LUM-1187)

Read-only. `task status` / `task wrapup` show only the open crossings, one
glance line each; `crossing list` shows the whole record the web Record panel
shows:

```bash
lumo crossing list            # session-bound task, open crossings only
lumo crossing list LUM-12 --all   # + the dispositioned history
lumo crossing list LUM-12 --all --json
```

- per crossing: `State` (`OPEN · blocks DONE` / `OPEN · advisory` / the ruling), `Detail`, `Detected`, `Occurrences` (`×N · last seen …`), `Reversible`, `Attribution`, `Rule` (`[ref] verbatim policy rule text`), `Diff` (edit old/new summary, `-`/`+` lines capped at 12 per side, plus the PR file link; only for display-safe categories), `Turn intent`, `System explanation`, `Agent explanations`, `Re-judge`, `AI triage`, `Remediation`;
- with `--all`, dispositioned rows add `Ruled by` (member/agent name + actor id; the id alone when the member directory can't be read), `Ruled at`, `Channel` (`WEB` / `CLI`), `Note`, `Changed` (last `from → to` correction, by whom, via which channel) and `Suppression rule` (`active` / `revoked …`); without `--all` the header says how many dispositioned rows were hidden;
- a field the server response does not carry prints `-` — never a guessed value;
- every free-text field is control-character-sanitized and folded to one line (diff lines are sanitized per line);
- `--json` prints `{ task, gateEnabled, crossings }` with the server's raw rows (same `--all` filter);
- it rules nothing — ruling stays `lumo crossing disposition` (the user's call) or the web panel.

When to suggest: the user asks what was flagged on a task and how it was ruled,
or you need the rule text / diff behind an open crossing before explaining it.

## Responding to an open crossing — `lumo crossing explain`

When a crossing looks like a false positive — or you want to leave a rationale
for the human reviewer — append a self-explanation ("申辩"):

```bash
lumo crossing explain <id> --note "this was a generated fixture, not a hand-edited migration"
lumo crossing explain <id> --task LUM-12 --note "…"   # unattached session: name the task
```

- it **only appends** a note — it **never clears the crossing or unblocks DONE** (the user rules, via `lumo crossing disposition` or the web panel);
- the note is shown to the human at disposition time, labelled _agent self-report · unverified_; earlier notes are immutable;
- `<id>` is the crossing's ref `<TEAM>-X<n>` (`LUM-X12`, any case — LUM-1059; the cuid also works) and must be a crossing on the **session-bound task**; an unattached session passes `--task <LUM-N>` (wins over the binding);
- **several crossings → one call** (LUM-845): `lumo crossing explain --file notes.json` with `[{"id": "<crossing>", "note": "<text>"}, …]` (`--file -` reads stdin). Each note is reported on its own `✓`/`✗` line; any failure exits 1, the others are still recorded. `--file` replaces `<id> --note`;
- **the note runs past the same detectors the crossing came from.** Quoting the flagged material back (path, command, matched text) records a **second** crossing. Describe what was flagged instead of reproducing it.

### AI triage (LUM-945)

Every ~5 minutes an AI triage pass reads each new OPEN crossing together with the task's title and description. When it judges the action a legitimate part of the task (P(legit) ≥ 0.6) it marks the crossing **AUTO_LEGIT**: off the open list, no longer blocking DONE, no human reviewer recorded. Below the threshold the score is kept and the crossing stays OPEN for the user.

- Your explanation is shown to it as **untrusted** text and is never enough on its own — what counts is the task context. Explain for the human, not to persuade the model.
- It is skipped for workspaces with AI review turned off, for evasion (`[base64-decoded]`) crossings, and for crossings with no task.
- Don't wait on it before relaying a crossing; one it leaves open still needs the user's ruling, and the user can re-rule an AUTO_LEGIT crossing as confirmed.

## Recording the user's ruling — `lumo crossing disposition` (LUM-769)

When the user has ruled on a crossing in chat, record it from the terminal:

```bash
lumo crossing disposition <id> --false-positive --note "covered by the run-outbound tests"
```

A gated mutation on the [confirmation protocol](confirmation.md), as a **three-step** handshake the server enforces:

- **Step 1 — no step flag.** Reads the crossing, obtains a server-signed stage-1 **read receipt**, prints an exit-4 envelope (severity, category, detail, `Seen ×N`, every explanation, the note, the ⚠ consequence lines, `Step 1 of 2 — read receipt issued … valid until <time>`). Nothing is written. Relay every line and **ask the user to confirm they have read it** — its `confirmCommand` ends in `--receipt <r1> --confirm-read`;
- **Step 2 — `--confirm-read --receipt <r1>`**, only after the user says they read it. Prints a second exit-4 envelope for the ruling itself (`Step 2 of 2 — record the ruling: OPEN → FALSE_POSITIVE`). Relay it and **ask the user to approve the ruling** — its `confirmCommand` ends in `--receipt <r2> --confirm`;
- **Step 3 — `--confirm --receipt <r2>`**, only after the user approves. POSTs the ruling (`FALSE_POSITIVE` | `CONFIRMED`); either clears that crossing's DONE block. **Never add `--confirm-read` or `--confirm` yourself** — each is the user's approval of that step;
- receipts are bound to the crossing, ruling, your session/member and the crossing's state, and expire after 10 minutes; a stale/forged/out-of-order receipt is refused with 409 and nothing is written — re-run without a step flag;
- `--task <LUM-N>` overrides the session binding; an already-matching ruling is a no-op (exit 0);
- **still web-only:** reverting a ruling to OPEN, repository suppression rules, and steward milestone crossings.

**Batch form (LUM-845):** `lumo crossing disposition <id1> <id2> <id3> --false-positive --note "…"` — same handshake, ONE envelope per step for the whole batch (a `── [i/N] crossing <id> ──` block per crossing, nothing trimmed), one receipt per crossing carried as `--receipt <ref>=<token>,…`. Mixed rulings = one batch per ruling. If the user disputes one, drop its id from the `confirmCommand` (it stays OPEN); adding an id after step 1 is refused. Step 3 reports every crossing `✓`/`✗`, exit 1 if any failed.

A blocking **security finding** has its own terminal path: `lumo finding disposition <id...> --false-positive | --accepted-risk [--note "…"]` — a plain exit-4 envelope (no receipts); relay it, add `--confirm` only after the user approves. Ids are on each `[SECURITY]` item's `Id:` row. See [pr-scan.md](pr-scan.md#finding-disposition).

After the last blocker is cleared, re-run the original `lumo task update <id> --status done --confirm` — its envelope was already approved.

## lumo task wrapup — the whole wrap-up in one read (LUM-841)

```bash
lumo task wrapup            # session-bound task
lumo task wrapup LUM-42     # explicit task
```

**When to suggest:** the task is near the end — a PR is open or merged, the user
asks "can we close this?" / "what is left?". Use it **instead of** chaining
`task status` + `pr scan` + a crossing read per crossing + `task update --status
done` (just to see the envelope) + `worktree list`. Run it again after clearing
an item.

Four numbered sections (`[1/4] Test cases` … `[4/4] DONE`), in the same layout as `task status` (headings, labelled rows, ≤3 indent levels, every command on its own line — LUM-1091):

1. **Test cases** — verdict signals (an unruled `PROVEN_DEFECT` item is followed by `Blocks DONE until the user rules on that run — one of:` and the two `lumo task testcase disposition <task>/TC<n> --known-defect` / `--not-a-defect` commands, one per line, for the **user's** ruling) and the no-test-case advisory.
2. **Security scans** — undispositioned findings (blocks DONE / advisory) and each linked PR's latest scan as layer rows, same grammar as `task status`.
3. **Boundary crossings** — every undispositioned crossing (`• <ref> [SEVERITY] CATEGORY (<gate>)`) with what the user needs to rule on it as rows (`Re-judged`, `Detail`, `Seen`, the `⚠ irreversible category` line, `Explanations` with one `- …` line each, or `Explanation: none — add one first` with the `crossing explain` command when a blocking row has none) and the step-1 `lumo crossing disposition … --task <id>` commands — per crossing (`The user rules — one of:`) or, with several, one **batch** command per ruling after the list.
4. **DONE** — a readiness verdict, then `Done gate: <headline>` with the same `Crossings` / `Security` / `Tests` rows as `task status` (LUM-1186), plus what moving to DONE would change (status, each linked PR with its merge state, each local worktree removed or kept with its reason — a kept worktree's `git -C … worktree remove` command on its own line). `READY` with every linked PR merged (≥1) is labelled `READY — one step: …` and ends with `All PRs merged, nothing blocks DONE — run it as-is (status only), no approval step:` and `lumo task update <id> --status done` (LUM-1106; add no other flag — anything besides `--status` takes the envelope, LUM-1116); `READY` with no linked PR ends with `Show the user the lines above. Only after they approve, run:` and the `--confirm` command alone on the next line; otherwise `Clear the items above, then run again:` and `lumo task wrapup <id>`.

| Level            | Meaning                                                                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `READY`          | nothing blocks and nothing is left agent-side — with ≥1 PR, all merged: run `lumo task update <id> --status done` directly (one step); with no PR: show the user the DONE lines, only after they approve run it with `--confirm` |
| `NOT YET`        | a linked PR is not merged                                                                                                                                                                                                        |
| `BLOCKED`        | a human-only gate would refuse DONE: blocking crossing, blocking security finding, unruled proven test-case defect — or the server's Done gate says blocked                                                                      |
| `CANNOT CONFIRM` | a read failed (status / crossings / task+PRs / security / the server's Done gate) — never read this as clear                                                                                                                     |
| `DONE`           | already closed                                                                                                                                                                                                                   |

**Red lines.** Read-only: GETs plus local `git` inspection; it requests no
disposition receipt and changes no status. A crossing or test-case ruling still
walks its handshake one exit-4 envelope at a time, and the DONE `--confirm`
command appears **only** at `READY` without a linked PR, as the user's approval
(with all PRs merged the plain one-step command is printed instead). When the current
directory is inside the task's worktree, run the DONE command from the main
checkout so the worktree can be removed.

## The DONE gate

`lumo task update <id> --status done` (no other flag — LUM-1116) runs in one
step when ≥1 linked PR, all merged, and the digest shows nothing blocking
(LUM-1106); otherwise it walks the
confirmation protocol: without `--confirm` it exits 4 with an envelope for the
user to approve. The server then
refuses DONE with **409** on an undispositioned blocking boundary crossing, a
blocking security finding, or a test case whose latest run is a proven defect;
the CLI turns that into exit 5 with a structured `DONE_BLOCKED` error listing
every blocker (LUM-755, see [tasks.md](tasks.md) and [confirmation.md](confirmation.md)).

## When a defect appears — fix in place, don't spin off a new task

On a review bounce **or** a self-review finding inside this task's scope, fix it
in place. **Do not** `lumo task create` for it — creating a task (and PR) for
in-scope rework launders a first-attempt failure and corrupts the flywheel
signal. When you're mid-task, `lumo task create` refuses the bare form and makes
you declare intent:

- `lumo task create --rework-of <id>` — redirects you back to fix the existing task and creates nothing;
- `lumo task create --new-scope` — genuinely new, separate work.

When someone reports a defect after the task was submitted (IN_REVIEW / DONE /
merged), fix it in place on this task and say so in the conversation; if it is a
new requirement, record it on the task (description / comment) before
proceeding.
