'use client'

import { useIntl } from 'react-intl'
import { formatDurationSec } from '@/lib/datetime/duration'
import type { RunReportTiles as RunReportTilesData } from './run-report-tiles'
import { fmtTokens } from './HonestReportSections'

export interface RunReportTilesProps {
  tiles: RunReportTilesData
  /** LUM-932: part of the cost was split by auto-detection, so the Cost tile
   *  carries an inaccuracy caption (only when a cost was actually measured). */
  costApproximate?: boolean
  /** LUM-932: some run started before the usage-dedupe fix, so the Cost tile
   *  carries the "overstated" marker (only when a cost was measured). */
  preDedupe?: boolean
}

function Tile({
  testId,
  label,
  value,
  measured,
  subCaptions = [],
  warning,
  preDedupeWarning,
  preDedupeTitle,
}: {
  testId: string
  label: string
  value: string
  /** false when `value` is the `record.report.notMeasured` fallback rather
   *  than a real reading (LUM-566) — rendered in the same muted/italic style
   *  as `HonestReportSections`' `CostSection`. */
  measured: boolean
  /** Muted lines under the value; only the measured ones are passed in (the
   *  Cost tile carries two: the token unit and the active-time reading). */
  subCaptions?: string[]
  /** Amber caution line rendered after the sub-captions. */
  warning?: string
  /** Second amber line: tokens recorded before the dedupe fix. */
  preDedupeWarning?: string
  preDedupeTitle?: string
}) {
  return (
    <div
      data-testid={testId}
      className='rounded-md border border-border px-3 py-2'
    >
      <div className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
        {label}
      </div>
      <div
        className={
          measured
            ? 'mt-1 text-heading text-foreground'
            : 'mt-1 text-[11px] italic leading-snug text-muted-foreground'
        }
      >
        {value}
      </div>
      {subCaptions.map(caption => (
        <div
          key={caption}
          className='mt-0.5 text-caption text-muted-foreground'
        >
          {caption}
        </div>
      ))}
      {warning ? (
        <div
          data-testid='cost-approximate'
          className='mt-0.5 text-caption text-warning-text'
        >
          {warning}
        </div>
      ) : null}
      {preDedupeWarning ? (
        <div
          data-testid='cost-pre-dedupe'
          title={preDedupeTitle}
          className='mt-0.5 text-caption text-warning-text'
        >
          {preDedupeWarning}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The Record tab's Run report KPI tiles (LUM-496 Task 4): PR iterations,
 * cost, and rework, laid out as a 3-column grid (1 on narrow screens). Purely presentational over `RunReportTiles` (the derived data) —
 * all derivation lives in `run-report-tiles.ts`. Every null field renders
 * `record.report.notMeasured`, never a `0` (LUM-566). The Cost tile also
 * carries the LUM-560 active-time reading as a sub-caption, so nothing the
 * retired `CostSection` showed was lost in the move to tiles.
 */
export function RunReportTiles({
  tiles,
  costApproximate = false,
  preDedupe = false,
}: RunReportTilesProps) {
  const intl = useIntl()

  const notMeasured = intl.formatMessage({
    id: 'record.report.notMeasured',
    defaultMessage: 'not recorded',
  })

  // The Cost tile carries the whole LUM-560 cost read-out the old CostSection
  // showed: the token unit under the headline number, and — LUM-560/LUM-642 —
  // the agent's active (non-idle) time, formatted by the one shared duration
  // formatter so the units stay localized and never fork.
  const costCaptions: string[] = []
  if (tiles.costTokens != null) {
    costCaptions.push(
      intl.formatMessage({
        id: 'record.report.costTokens',
        defaultMessage: 'tokens',
      })
    )
  }
  costCaptions.push(
    `${intl.formatMessage({
      id: 'acceptance.cost.activeTime',
      defaultMessage: 'Active time',
    })} ${formatDurationSec(intl, tiles.activeTimeSec)}`
  )

  return (
    <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
      <Tile
        testId='tile-prIterations'
        label={intl.formatMessage({
          id: 'record.report.prIterations',
          defaultMessage: 'PR iterations',
        })}
        value={
          tiles.prIterations ? String(tiles.prIterations.count) : notMeasured
        }
        measured={tiles.prIterations != null}
        subCaptions={
          tiles.prIterations
            ? [
                intl.formatMessage(
                  {
                    id: 'record.report.prRange',
                    defaultMessage: '#{first}–#{last}',
                  },
                  {
                    first: tiles.prIterations.first,
                    last: tiles.prIterations.last,
                  }
                ),
              ]
            : []
        }
      />
      <Tile
        testId='tile-costTokens'
        label={intl.formatMessage({
          id: 'record.report.cost',
          defaultMessage: 'Cost',
        })}
        value={
          tiles.costTokens == null ? notMeasured : fmtTokens(tiles.costTokens)
        }
        measured={tiles.costTokens != null}
        subCaptions={costCaptions}
        {...(costApproximate && tiles.costTokens != null
          ? {
              warning: intl.formatMessage({
                id: 'record.report.costApproximate',
                defaultMessage:
                  'Includes auto-detected work — may be inaccurate',
              }),
            }
          : {})}
        {...(preDedupe && tiles.costTokens != null
          ? {
              preDedupeWarning: intl.formatMessage({
                id: 'usage.preDedupe.marker',
                defaultMessage: '≈2× overstated',
              }),
              preDedupeTitle: intl.formatMessage({
                id: 'usage.preDedupe.notice',
                defaultMessage:
                  'Token figures recorded before Oct 3, 2026 are overstated by about 2× (an older CLI counted each message several times). Newer figures are accurate.',
              }),
            }
          : {})}
      />
      <Tile
        testId='tile-rework'
        label={intl.formatMessage({
          id: 'record.report.rework',
          defaultMessage: 'Rework',
        })}
        value={String(tiles.rework)}
        measured
      />
    </div>
  )
}
