# Typography Scale

Six semantic tiers carried as Tailwind v4 font-size tokens in `app/globals.css`.
Each `text-{tier}` utility bundles font-size + line-height + font-weight +
letter-spacing. **Color is orthogonal** — apply `text-muted-foreground` /
`text-foreground` separately.

| Utility            | size | weight         | line-height | letter-spacing | Use                                                   |
| ------------------ | ---- | -------------- | ----------- | -------------- | ----------------------------------------------------- |
| `text-caption`     | 12px | medium (500)   | 1.4         | —              | metadata, timestamps, labels, secondary table columns |
| `text-body`        | 14px | normal (400)   | 1.5         | —              | default body — table cells, descriptions, most text   |
| `text-body-strong` | 14px | medium (500)   | 1.5         | —              | emphasized body, row titles, form labels              |
| `text-title`       | 16px | semibold (600) | 1.4         | -0.01em        | card titles, section titles                           |
| `text-heading`     | 20px | semibold (600) | 1.3         | -0.01em        | page / panel main heading                             |
| `text-display`     | 30px | bold (700)     | 1.2         | -0.02em        | hero, large empty-state copy (low frequency)          |

## When to use which

- Reach for a tier instead of hand-combining `text-sm font-medium text-foreground`.
- Pick the tier by **role** (is this a caption? a body line? a section title?), not by pixel size.
- Need a weight heavier than the tier default (rare)? Add an explicit `font-*` AFTER
  the tier class — `cn()` is configured so the tier (a font-size) and the weight
  (a separate group) both survive merging. Example: `text-caption font-semibold` for
  a 12px label that must out-weigh ambient 500 captions.

## Migration mapping (from raw utilities)

| Old                                     | New                                          |
| --------------------------------------- | -------------------------------------------- |
| `text-xs`                               | `text-caption`                               |
| `text-xs font-medium`                   | `text-caption` (caption already carries 500) |
| `text-sm` (body)                        | `text-body`                                  |
| `text-sm font-medium` / `font-semibold` | `text-body-strong`                           |
| `text-base` / `text-lg` title           | `text-title`                                 |
| `text-xl` / `text-2xl` heading          | `text-heading`                               |
| `text-3xl`+ display                     | `text-display`                               |

**Note on weight:** the tiers bundle a deliberate, consistent weight. Because raw
`text-xs`/`text-sm` carried no weight class (rendering at the inherited ~400),
migration intentionally unifies weights — captions and emphasized body settle at
500 (body-strong matches shadcn's `font-medium` on buttons, tabs and labels;
user ruling in LUM-1244). This is a small, intentional hierarchy normalization,
not a pixel-for-pixel preservation of the old rendering.

## tailwind-merge

The tiers are registered in `lib/utils.ts` (`extendTailwindMerge`, classGroup
`font-size`). Without that registration, `cn('text-caption text-muted-foreground')`
would drop the color (tailwind-merge would treat both as the `text-` group). A
regression test guards this: `__tests__/lib/cn-typography-tiers.test.ts`.

## Components

`components/ui/typography.tsx` is routed through these tiers:
`TypographyH1`→display, `H2`/`H3`→heading, `H4`–`H6`→title, `TypographyP`→body,
`TypographyLarge`→title, `TypographyLead`→heading,
`TypographySmall`/`TypographyMuted`→caption.
(`TypographyInlineCode`/`TypographyCode` keep `text-sm` — code prose, outside the scale.)

## Status

Established in LUM-260. LUM-1244 migrated the rest of the app UI (landing and
`components/ui/typography.tsx` excepted) and added the `type-scale` rule to
`lint:tokens`, which flags raw `text-xs|sm|lg|xl…`, arbitrary `text-[<n>px|rem]`
and `font-medium|bold` in new code — see `docs/design-system.md` → Typography
scale.
