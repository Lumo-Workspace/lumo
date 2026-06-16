'use client'

import { useIntl } from 'react-intl'
import type { LineageResponse } from '../../types'

type Operation = LineageResponse['totals']['topOperations'][number]

export function TopOperations({
  operations,
  taskIdentifier,
}: {
  operations: Operation[]
  taskIdentifier: string
}) {
  const intl = useIntl()
  if (operations.length === 0) return null

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
          {operations.map(op => (
            <tr key={op.tool} className='border-t border-border/60'>
              <td className='py-1 font-mono text-foreground'>{op.tool}</td>
              <td className='py-1 text-right tabular-nums text-muted-foreground'>
                {intl.formatNumber(op.output)}
              </td>
              <td className='py-1 text-right tabular-nums text-muted-foreground'>
                {intl.formatNumber(op.cacheRead)}
              </td>
              <td className='py-1 text-right font-medium tabular-nums text-foreground'>
                {intl.formatNumber(op.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className='mt-2 text-[10px] leading-relaxed text-muted-foreground'>
        {intl.formatMessage(
          {
            id: 'lineage.operations.footnote',
            defaultMessage:
              '归因为启发式（并行工具按步均分）；缓存读取为结构性成本。完整明细见 lumo cost --task {id}',
          },
          { id: taskIdentifier }
        )}
      </p>
    </div>
  )
}
