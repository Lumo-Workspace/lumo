# Initiatives (team-level, `LUM-INIT-<n>`)

An **Initiative** is a team-level strategic goal that tasks roll up to. Two origins land in the same list:

- **Direct** — `lumo initiative create`, no plan run required (`planRunId = null`, status `ACTIVE`).
- **Materialised** — produced by the `lumo plan` converter's gate C, carrying its lineage (see [plan-runs.md](plan-runs.md)).

## `lumo initiative create "<goal>" [--assumption <text>]`

Create an Initiative directly. Prints the `LUM-INIT-<n>` id. `--assumption` records the bet (赌注旁注) behind it — the thing that, if false, makes the initiative the wrong call. A blank goal is rejected (400).

**When to suggest**: the user wants to stand up a strategic initiative directly — "建一个 initiative", "create an initiative", "开一个举措" — without running the converter.

```bash
lumo initiative create "Ship the initiatives browse surface" --assumption "teams curate initiatives directly"
```

## `lumo initiative list`

Print the team's initiatives newest-first, one line each: the `LUM-INIT-<n>` id, status (`PROPOSED` | `PLANNED` | `ACTIVE` | `COMPLETED` | `CANCELLED`) and goal.

Browsable in web at `/workspace/<slug>/initiatives` (sidebar → Initiatives), where each links to its lineage — the ideas it consumed and the tasks attached to it.

**When to suggest**: the user wants to see the team's initiatives ("看看 initiatives", "list the initiatives").

```bash
lumo initiative list
```

## `lumo initiative update <initiative> [flags]` (LUM-821)

`<initiative>` is the `LUM-INIT-<n>` id or just its number. Provide at least one flag; `""` clears the nullable ones.

| Flag                     | Notes                                                                        |
| ------------------------ | ---------------------------------------------------------------------------- |
| `-s, --status <value>`   | `proposed \| planned \| active \| completed \| cancelled` (case-insensitive) |
| `--goal <text>`          | New goal statement (the initiative's name).                                  |
| `-d, --description <>`   | Body text; `""` clears.                                                      |
| `-p, --priority <level>` | `low \| medium \| high \| urgent`; `""` clears.                              |
| `--start` / `--target`   | `YYYY-MM-DD`, your local day; `""` clears.                                   |

```bash
lumo initiative update LUM-INIT-3 --status completed
lumo initiative update 3 --target 2026-12-31 --priority high
```

## `lumo initiative progress add <initiative> <body> [--health <value>]` / `progress list <initiative>`

Append-only progress posts (Linear's initiative updates): what changed, plus an optional health `on_track | at_risk | off_track`. A post is never edited — post a new one to correct. `progress list` prints them newest-first as `date  HEALTH  author` over the indented body (at most 50).

```bash
lumo initiative progress add LUM-INIT-3 "Search + filters shipped; members next" --health on_track
lumo initiative progress list LUM-INIT-3
```

**When to suggest**: a milestone or batch of tasks under an initiative landed ("post an update on the initiative"), or the user asks how an initiative is going — read `progress list` before summarising.
