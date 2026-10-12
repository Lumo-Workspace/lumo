# Tags

### `lumo tag list [--json]` — workspace tags (LUM-821)

Every tag in the workspace, sorted by name, with its color and how many tasks / docs carry it:

```
bug    #ff0000  3 tasks  2 docs
infra  -        1 task   0 docs
```

Columns align by display width (CJK names count 2). On a TTY a `NAME  COLOR  TASKS  DOCS` header comes first; piped output has none. On a colour terminal the usage counts are dimmed; piped / non-TTY output (and `NO_COLOR`) is plain text with no escape sequences.

```bash
lumo tag list
```

### `lumo tag create <name> [--color <hex>]`

Create a tag (≤30 chars, `--color` as `#rrggbb`). A duplicate name is refused (409). This only creates the tag — attach it with `lumo task update <id> --add-tag <name>` (which also find-or-creates a missing tag, but without a color).

```bash
lumo tag create infra --color "#3b82f6"
```

### When to suggest

- Before `task search --tag` or `task update --add-tag`, when you are unsure of a tag's exact name — `tag list` avoids a typo minting a stray tag via `--add-tag`.
- "What labels do we have", "create a label for X".
