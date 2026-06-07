# Control Size / Density Scale

Control height and inline padding are carried as Tailwind v4 `--spacing-*`
tokens in `app/globals.css` (LUM-287). Height and inline padding are **separate
axes** — a control can be md-height with sm-padding (Input is). Pick a height
tier and an inset tier independently.

## Height tiers

| Utility          | value   | px   | Replaces |
| ---------------- | ------- | ---- | -------- |
| `h-control-sm`   | 2rem    | 32px | `h-8`    |
| `h-control-md`   | 2.25rem | 36px | `h-9`    |
| `h-control-lg`   | 2.5rem  | 40px | `h-10`   |

`w-control-md` (2.25rem) backs the square icon button.

## Inline-padding tiers

| Utility               | value   | px   | Replaces |
| --------------------- | ------- | ---- | -------- |
| `px-control-inset-sm` | 0.75rem | 12px | `px-3`   |
| `px-control-inset-md` | 1rem    | 16px | `px-4`   |
| `px-control-inset-lg` | 2rem    | 32px | `px-8`   |

## Current consumers

| Component        | Height          | Inline padding         |
| ---------------- | --------------- | ---------------------- |
| Button `default` | `h-control-md`  | `px-control-inset-md`  |
| Button `sm`      | `h-control-sm`  | `px-control-inset-sm`  |
| Button `lg`      | `h-control-lg`  | `px-control-inset-lg`  |
| Button `icon`    | `h-control-md`  | `w-control-md` (square)|
| Input            | `h-control-md`  | `px-control-inset-sm`  |
| Badge            | content-sized   | `px-control-inset-sm`  |

## Not part of this scale

- `gap` (icon↔label) — uniform `gap-2`, not a density tier.
- Text size — owned by the typography scale (`text-caption` / `text-body` …).
- Vertical padding (`py-*`) — per-component constant; height tiers fix box height.

## Adjusting density

Edit the token value in `app/globals.css`; every consumer follows. The
`__tests__/styles/control-size-tokens.test.ts` guard ensures no tier is dropped
or renamed.

## Follow-up

Raw `h-8/9/10` and `px-3/4/8` still appear at ~40 call sites outside these
atoms. Converging them onto `h-control-*` / `px-control-inset-*` is future work.
