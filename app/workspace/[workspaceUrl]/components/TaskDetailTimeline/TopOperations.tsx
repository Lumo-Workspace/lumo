'use client'

import { Fragment, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useIntl } from 'react-intl'
import type { LineageResponse } from '../../types'

type Operation = LineageResponse['totals']['topOperations'][number]

/** Most commands shown under an expanded row; the full list is in `lumo usage show`. */
const MAX_COMMANDS = 8

export function TopOperations({
  operations,
  taskIdentifier,
}: {
  operations: Operation[]
  taskIdentifier: string
}) {
  const intl = useIntl()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  if (operations.length === 0) return null

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
      <td className='py-1 text-right tabular-nums text-muted-foreground'>
        {intl.formatNumber(row.output)}
      </td>
      <td className='py-1 text-right tabular-nums text-muted-foreground'>
        {intl.formatNumber(row.input)}
      </td>
      <td className='py-1 text-right tabular-nums text-muted-foreground'>
        {intl.formatNumber(row.cacheCreation)}
      </td>
      <td className='py-1 text-right tabular-nums text-muted-foreground'>
        {intl.formatNumber(row.cacheRead)}
      </td>
    </>
  )

  return (
    <div className='border-b border-border px-3 py-3'>
      <div className='mb-2 text-caption font-medium text-muted-foreground'>
        {intl.formatMessage({
          id: 'lineage.operations.title',
          defaultMessage: 'Top operations · 按 token 成本',
        })}
      </div>
      <table className='w-full text-[11px]'>
        <thead>
          <tr className='text-muted-foreground'>
            <th className='py-1 text-left font-medium'>
              {intl.formatMessage({
                id: 'lineage.operations.col.tool',
                defaultMessage: '工具',
              })}
            </th>
            <th className='py-1 text-right font-medium'>
              {intl.formatMessage({
                id: 'lineage.operations.col.output',
                defaultMessage: '输出',
              })}
            </th>
            <th className='py-1 text-right font-medium'>
              {intl.formatMessage({
                id: 'lineage.operations.col.input',
                defaultMessage: '输入',
              })}
            </th>
            <th className='py-1 text-right font-medium'>
              {intl.formatMessage({
                id: 'lineage.operations.col.cacheCreate',
                defaultMessage: '缓存创建',
              })}
            </th>
            <th className='py-1 text-right font-medium'>
              {intl.formatMessage({
                id: 'lineage.operations.col.cacheRead',
                defaultMessage: '缓存读取',
              })}
            </th>
            <th className='py-1 text-right font-medium'>
              {intl.formatMessage({
                id: 'lineage.operations.col.total',
                defaultMessage: '合计',
              })}
            </th>
          </tr>
        </thead>
        <tbody>
          {operations.map(op => {
            const commands = op.commands ?? []
            const isOpen = expanded.has(op.tool)
            return (
              <Fragment key={op.tool}>
                <tr className='border-t border-border/60'>
                  <td className='py-1 font-mono text-foreground'>
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
                  </td>
                  {cells(op)}
                  <td className='py-1 text-right font-medium tabular-nums text-foreground'>
                    {intl.formatNumber(op.total)}
                  </td>
                </tr>
                {isOpen
                  ? commands.slice(0, MAX_COMMANDS).map(c => (
                      <tr key={`${op.tool}:${c.command}`}>
                        <td className='py-0.5 pl-4 font-mono text-muted-foreground'>
                          ↳ {c.command}
                        </td>
                        {cells(c)}
                        <td className='py-0.5 text-right tabular-nums text-muted-foreground'>
                          {intl.formatNumber(c.total)}
                        </td>
                      </tr>
                    ))
                  : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      <p className='mt-2 text-[10px] leading-relaxed text-muted-foreground'>
        {intl.formatMessage(
          {
            id: 'lineage.operations.footnote',
            defaultMessage:
              '归因为启发式（并行工具按步均分）；缓存读取为结构性成本。完整明细见 lumo usage show --task {id}（CLI 1.125 及更早：lumo cost --task {id}）',
          },
          { id: taskIdentifier }
        )}
      </p>
    </div>
  )
}
