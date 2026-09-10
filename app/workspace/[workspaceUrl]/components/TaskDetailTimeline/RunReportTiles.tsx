'use client'

import { useIntl } from 'react-intl'
import type { RunReportTiles as RunReportTilesData } from './run-report-tiles'
import { fmtTokens } from './HonestReportSections'

export interface RunReportTilesProps {
  tiles: RunReportTilesData
}

function Tile({
  testId,
  label,
  value,
  measured,
  subCaption,
}: {
  testId: string
  label: string
  value: string
  /** false when `value` is the `record.report.notMeasured` fallback rather
   *  than a real reading (LUM-566) — rendered in the same muted/italic style
   *  as `HonestReportSections`' `CostSection`. */
  measured: boolean
  subCaption?: string
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
      {subCaption ? (
        <div className='mt-0.5 text-caption text-muted-foreground'>
          {subCaption}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The Record tab's Run report KPI tiles (LUM-496 Task 4): PR iterations, R1
 * pass rate, cost, and rework, laid out as a 4-column grid (2 on narrow
 * screens). Purely presentational over `RunReportTiles` (the derived data) —
 * all derivation lives in `run-report-tiles.ts`. Every null field renders
 * `record.report.notMeasured`, never a `0` (LUM-566).
 */
export function RunReportTiles({ tiles }: RunReportTilesProps) {
  const intl = useIntl()

  const notMeasured = intl.formatMessage({
    id: 'record.report.notMeasured',
    defaultMessage: 'not recorded',
  })

  return (
    <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
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
        {...(tiles.prIterations
          ? {
              subCaption: intl.formatMessage(
                {
                  id: 'record.report.prRange',
                  defaultMessage: '#{first}–#{last}',
                },
                {
                  first: tiles.prIterations.first,
                  last: tiles.prIterations.last,
                }
              ),
            }
          : {})}
      />
      <Tile
        testId='tile-passRateR1'
        label={intl.formatMessage({
          id: 'record.report.passRateR1',
          defaultMessage: 'Pass rate R1',
        })}
        value={tiles.passRateR1 == null ? notMeasured : `${tiles.passRateR1}%`}
        measured={tiles.passRateR1 != null}
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
        {...(tiles.costTokens == null
          ? {}
          : {
              subCaption: intl.formatMessage({
                id: 'record.report.costTokens',
                defaultMessage: 'tokens',
              }),
            })}
      />
      <Tile
        testId='tile-rework'
        label={intl.formatMessage({
          id: 'record.report.rework',
          defaultMessage: 'Rework',
        })}
        value={tiles.rework == null ? notMeasured : String(tiles.rework)}
        measured={tiles.rework != null}
      />
    </div>
  )
}
