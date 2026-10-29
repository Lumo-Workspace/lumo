'use client'

import { Fragment, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useIntl } from 'react-intl'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { LineageResponse } from '../../types'

type Operation = LineageResponse['totals']['topOperations'][number]
type Precision = LineageResponse['totals']['operationsPrecision']

/** Above this cache-read share the table mostly measures context size, not tools. */
const CACHE_READ_DOMINANT = 0.9

/** Most commands shown under an expanded row; the full list is in `lumo usage show`. */
const MAX_COMMANDS = 8

/** Dense breakdown: the Table primitive's rhythm, at caption size. */
const HEAD = 'h-auto px-0 py-1 text-caption'
const NUM = 'py-1 pl-2 pr-0 text-right tabular-nums text-muted-foreground'

export function TopOperations({
  operations,
  precision,
  taskIdentifier,
}: {
  operations: Operation[]
  precision: Precision
  taskIdentifier: string
}) {
  const intl = useIntl()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  if (operations.length === 0) return null

  const title = (
    <div className='mb-2 text-caption text-muted-foreground'>
      {intl.formatMessage({
        id: 'lineage.operations.title',
        defaultMessage: 'Top operations · 按 token 成本',
      })}
    </div>
  )
  const asPct = (share: number) => Math.round(share * 100)

  // LUM-1294: every token fell to the thinking bucket — a one-row table would
  // look precise while saying nothing, so show the total as a plain line.
  if (precision && !precision.hasToolRows) {
    const total = operations.reduce((t, op) => t + op.total, 0)
    return (
      <div className='border-b border-border px-3 py-3'>
        {title}
        <p className='text-caption text-muted-foreground'>
          {intl.formatMessage(
            {
              id: 'lineage.operations.noBreakdown',
              defaultMessage:
                '{total} tokens in total · no per-tool breakdown was recorded for this task.',
            },
            { total: intl.formatNumber(total) }
          )}
        </p>
      </div>
    )
  }

  const toggle = (tool: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(tool)) next.delete(tool)
      else next.add(tool)
      return next
    })
  const cells = (
    row: Pick<
      Operation,
      'output' | 'input' | 'cacheCreation' | 'cacheRead' | 'total'
    >
  ) => (
    <>
      <TableCell className={NUM}>{intl.formatNumber(row.output)}</TableCell>
      <TableCell className={NUM}>{intl.formatNumber(row.input)}</TableCell>
      <TableCell className={NUM}>
        {intl.formatNumber(row.cacheCreation)}
      </TableCell>
      <TableCell className={NUM}>{intl.formatNumber(row.cacheRead)}</TableCell>
    </>
  )

  return (
    <div className='border-b border-border px-3 py-3'>
      {title}
      <Table className='text-caption'>
        <TableHeader>
          <TableRow className='hover:bg-transparent'>
            <TableHead className={HEAD}>
              {intl.formatMessage({
                id: 'lineage.operations.col.tool',
                defaultMessage: '工具',
              })}
            </TableHead>
            <TableHead className={`${HEAD} text-right`}>
              {intl.formatMessage({
                id: 'lineage.operations.col.output',
                defaultMessage: '输出',
              })}
            </TableHead>
            <TableHead className={`${HEAD} text-right`}>
              {intl.formatMessage({
                id: 'lineage.operations.col.input',
                defaultMessage: '输入',
              })}
            </TableHead>
            <TableHead className={`${HEAD} text-right`}>
              {intl.formatMessage({
                id: 'lineage.operations.col.cacheCreate',
                defaultMessage: '缓存创建',
              })}
            </TableHead>
            <TableHead className={`${HEAD} text-right`}>
              {intl.formatMessage({
                id: 'lineage.operations.col.cacheRead',
                defaultMessage: '缓存读取',
              })}
            </TableHead>
            <TableHead className={`${HEAD} text-right`}>
              {intl.formatMessage({
                id: 'lineage.operations.col.total',
                defaultMessage: '合计',
              })}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {operations.map(op => {
            const commands = op.commands ?? []
            const isOpen = expanded.has(op.tool)
            const shown = commands.slice(0, MAX_COMMANDS)
            return (
              <Fragment key={op.tool}>
                {/* One rule per group: an open row hands its bottom rule to
                    its last command row. */}
                <TableRow className={isOpen ? 'border-0' : undefined}>
                  <TableCell className='px-0 py-1 font-mono text-foreground'>
                    {commands.length > 0 ? (
                      <button
                        type='button'
                        aria-expanded={isOpen}
                        onClick={() => toggle(op.tool)}
                        className='inline-flex items-center gap-1 text-left hover:underline'
                      >
                        <ChevronRight
                          className={`size-3 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`}
                          aria-hidden
                        />
                        {op.tool}
                      </button>
                    ) : (
                      op.tool
                    )}
                  </TableCell>
                  {cells(op)}
                  <TableCell className={`${NUM} text-foreground`}>
                    {intl.formatNumber(op.total)}
                  </TableCell>
                </TableRow>
                {isOpen
                  ? shown.map((c, i) => (
                      <TableRow
                        key={`${op.tool}:${c.command}`}
                        className={
                          i < shown.length - 1 ? 'border-0' : undefined
                        }
                      >
                        <TableCell className='py-0.5 pl-4 pr-0 font-mono text-muted-foreground'>
                          ↳ {c.command}
                        </TableCell>
                        {cells(c)}
                        <TableCell className={NUM}>
                          {intl.formatNumber(c.total)}
                        </TableCell>
                      </TableRow>
                    ))
                  : null}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
      {precision ? (
        <div className='mt-2 flex flex-col gap-0.5 text-caption text-foreground'>
          {/* null = no tool-using turns, so there is no coverage to state. */}
          {precision.perStepPct !== null ? (
            <p>
              {precision.perStepPct === 1
                ? intl.formatMessage({
                    id: 'lineage.operations.precisionPerStep',
                    defaultMessage: 'Measured per step.',
                  })
                : intl.formatMessage(
                    {
                      id: 'lineage.operations.precisionPerTurn',
                      defaultMessage:
                        'Estimated per turn: {pct}% of tool-using turns were measured per step; the rest is split evenly across the tools in the turn.',
                    },
                    // Round, then cap at 99: a near-complete share (0.996)
                    // must not read "Estimated per turn: 100%" — only an exact
                    // 1 is per step — and flooring would turn 0.29 into 28%.
                    { pct: Math.min(99, asPct(precision.perStepPct)) }
                  )}
            </p>
          ) : null}
          {precision.cacheReadPct > CACHE_READ_DOMINANT ? (
            <p>
              {intl.formatMessage(
                {
                  id: 'lineage.operations.cacheReadDominant',
                  defaultMessage:
                    '{pct}% of these tokens are cache reads, the structural cost of a long context rather than of any one tool.',
                },
                { pct: asPct(precision.cacheReadPct) }
              )}
            </p>
          ) : null}
        </div>
      ) : null}
      <p className='mt-2 text-caption text-muted-foreground'>
        {intl.formatMessage(
          {
            id: 'lineage.operations.footnote',
            defaultMessage:
              "Tools that run in parallel within one step share that step's tokens evenly; cache read is structural cost. Full breakdown: lumo usage show --task {id} (CLI 1.125 and older: lumo cost --task {id})",
          },
          { id: taskIdentifier }
        )}
      </p>
    </div>
  )
}
