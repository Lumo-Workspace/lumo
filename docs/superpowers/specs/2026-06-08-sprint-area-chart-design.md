# Sprint burnup → shadcn area chart [LUM-322]

## Goal

Replace the hand-rolled SVG burnup chart in `SprintProgressChart.tsx` with a
shadcn/ui Area Chart (Recharts-based) for a cleaner, themeable, interactive
(hover tooltip) visualization. Reuse the existing `--chart-*` oklch palette
tokens so it adapts to light/dark automatically. **Data, API, and i18n keys are
unchanged** — only the rendering layer changes.

## Scope

In scope:

- Add `recharts` dependency (shadcn charts are Recharts-based).
- Add the shadcn `components/ui/chart.tsx` primitive (`ChartContainer`,
  `ChartStyle`, `ChartTooltip`, `ChartTooltipContent`). Reusable for future
  dashboard chart migrations.
- Rewrite `SprintProgressChart.tsx` to render the burnup with Recharts inside
  `ChartContainer`.

Out of scope (stay focused — separate tasks):

- The other custom dashboard charts (StatusDistribution / CompletionTrend /
  MemberWorkload / TokenCostBreakdown).
- Any change to the burnup API, shaper, or `SprintBurnupResponse` shape.
- Burndown semantics — this remains a **burnup** (completed-vs-scope).

## Visual design (approved via mock)

Three series from `SprintBurnupResponse.series[] = {date, scope, completed,
projected}`:

| Series    | Mark                                              | Token                                 |
| --------- | ------------------------------------------------- | ------------------------------------- |
| completed | filled **area** (gradient 0.35→0.02) + solid line | `--chart-1` (blue)                    |
| scope     | solid line (reference ceiling), low opacity       | `--muted-foreground` (~0.55 opacity)  |
| projected | dashed line, extends to sprint end                | `--chart-1` (blue), `strokeDasharray` |

- Gradient `<defs>` + `<linearGradient>` for the completed area fill.
- `CartesianGrid` strokes use `--border`; axis ticks use `--muted-foreground`.
- X axis: dates formatted short (e.g. `M/D`); Y axis: minimal, domain `[0, maxY]`
  where `maxY = max(scopeTotal, 1)`.
- Hover `ChartTooltip` shows the date + each series value.

## Component structure

```
SprintProgressChart (client)
├── Card(title)                       // unchanged wrapper, i18n title
├── loading → animate-pulse skeleton  // unchanged
├── empty (series empty || scopeTotal===0) → empty message  // unchanged
└── data →
    ├── buildBurnupChartData(burnup)  // PURE, exported, unit-tested
    │     → { rows, maxY }            // rows feed Recharts dataKeys
    ├── ChartContainer(config) > AreaChart(rows)
    │     ├── defs/linearGradient (completed)
    │     ├── CartesianGrid, XAxis, YAxis
    │     ├── ChartTooltip
    │     ├── Area  dataKey="completed"
    │     ├── Line  dataKey="scope"
    │     └── Line  dataKey="projected" (dashed)
    └── HTML legend (spans)           // kept OUTSIDE recharts → always
                                      //   in DOM, jsdom-assertable, matches mock
```

`buildBurnupChartData` is split out as a pure function so the null-handling
(future days have `completed: null`; pre-anchor days have `projected: null`) is
unit-testable without rendering Recharts.

## Why a custom HTML legend (not ChartLegend)

Recharts' `<Legend>` only renders when the chart itself renders, and Recharts'
`ResponsiveContainer` renders nothing in jsdom (zero measured size). Keeping the
legend as plain HTML below the chart keeps it assertable in component tests and
matches the approved mock (legend sits below the plot).

## Testing

`recharts` + jsdom: `ResponsiveContainer` measures 0×0 and renders no SVG. Plan:

1. **Pure unit test** for `buildBurnupChartData`: maxY = `max(scopeTotal, 1)`;
   nulls preserved per-row; row count == series length.
2. **Component tests** (jsdom): heading renders; legend labels (Scope /
   Completed / Projected) render; empty state when `scopeTotal === 0`; loading
   skeleton when `isLoading`.
3. Mock `recharts` `ResponsiveContainer` → fixed-size wrapper so the `AreaChart`
   mounts, then assert an `<svg>` is present (chart renders at all). Keep
   internal-path assertions light — the pure function covers data correctness.

The existing `__tests__/components/SprintProgressChart.test.tsx` (asserts
`<polyline>` count) is **replaced** by the above — polylines no longer exist.

## Verification

- `npx tsc --noEmit` clean.
- `npx jest __tests__/components/SprintProgressChart.test.tsx` + the pure-fn test
  green.
- Visual: render via the local mock workflow already used for design sign-off.

## PR notes

- New dependency: `recharts` (call out in PR description per CLAUDE.md).
- No schema change, no migration, no new i18n keys.
