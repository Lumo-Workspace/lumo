'use client'

import { useIntl } from 'react-intl'
import { InfoTooltip } from './InfoTooltip'
import type { LineageResponse } from '../../types'

type Funnel = LineageResponse['totals']['funnel']

/** Integer percent, 0 when denominator is 0 (mirrors CLI `pct`, never NaN). */
function pct(num: number, den: number): number {
  return den === 0 ? 0 : Math.round((num / den) * 100)
}

function barWidth(value: number, impressions: number): string {
  if (impressions === 0) return '0%'
  const w = Math.round((value / impressions) * 100)
  return value > 0 && w === 0 ? '2px' : `${w}%`
}

export function DisclosureFunnel({ funnel }: { funnel: Funnel }) {
  const intl = useIntl()
  if (funnel.impressions === 0) return null

  const rows = [
    {
      label: intl.formatMessage({
        id: 'lineage.funnel.impressions',
        defaultMessage: '曝光',
      }),
      tip: intl.formatMessage({
        id: 'lineage.funnel.impressions.tip',
        defaultMessage: '这些记忆和资料一共被塞进 AI 对话多少次。',
      }),
      value: funnel.impressions,
      pctText: null as string | null,
    },
    {
      label: intl.formatMessage({
        id: 'lineage.funnel.index',
        defaultMessage: '仅索引',
      }),
      tip: intl.formatMessage({
        id: 'lineage.funnel.index.tip',
        defaultMessage:
          '其中有多少条只先给了「一句话目录」，没有一上来就把整段全文塞进去——这样更省。括号是占曝光的比例。',
      }),
      value: funnel.index,
      pctText: intl.formatMessage(
        { id: 'lineage.funnel.pct', defaultMessage: '{pct}%' },
        { pct: pct(funnel.index, funnel.impressions) }
      ),
    },
    {
      label: intl.formatMessage({
        id: 'lineage.funnel.pulled',
        defaultMessage: '已展开',
      }),
      tip: intl.formatMessage({
        id: 'lineage.funnel.pulled.tip',
        defaultMessage:
          '那些「一句话目录」里，AI 后来真正点开看了全文的有几条。括号的分母是索引条数。',
      }),
      value: funnel.pulled,
      pctText: intl.formatMessage(
        { id: 'lineage.funnel.ofIndex', defaultMessage: '占索引 {pct}%' },
        { pct: pct(funnel.pulled, funnel.index) }
      ),
    },
    {
      label: intl.formatMessage({
        id: 'lineage.funnel.used',
        defaultMessage: '已采用',
      }),
      tip: intl.formatMessage({
        id: 'lineage.funnel.used.tip',
        defaultMessage: '最后真正帮上忙、被采用的有几条。括号是占曝光的比例。',
      }),
      value: funnel.used,
      pctText: intl.formatMessage(
        { id: 'lineage.funnel.pct', defaultMessage: '{pct}%' },
        { pct: pct(funnel.used, funnel.impressions) }
      ),
    },
  ]

  return (
    <div className='border-b border-border px-3 py-3'>
      <div className='mb-2 flex items-center gap-1 text-caption font-medium text-muted-foreground'>
        {intl.formatMessage({
          id: 'lineage.funnel.title',
          defaultMessage: '披露漏斗',
        })}
        <InfoTooltip
          label={intl.formatMessage({
            id: 'lineage.funnel.title.tip',
            defaultMessage:
              '给这个任务喂了多少记忆和资料，一层层筛下来真正帮上忙的有多少。看「喂得多、用得少」的程度。',
          })}
        />
      </div>
      <div className='flex flex-col gap-1.5'>
        {rows.map(r => (
          <div key={r.label} className='flex items-center gap-2'>
            <span className='flex w-16 shrink-0 items-center gap-1 text-muted-foreground'>
              {r.label}
              <InfoTooltip label={r.tip} />
            </span>
            <span
              className='h-3 rounded-sm bg-primary/70'
              style={{ width: barWidth(r.value, funnel.impressions) }}
            />
            <span className='font-medium tabular-nums text-foreground'>
              {r.value}
            </span>
            {r.pctText && (
              <span className='text-[11px] text-muted-foreground'>
                {r.pctText}
              </span>
            )}
          </div>
        ))}
      </div>
      {funnel.tokensSaved != null && (
        <div className='mt-2'>
          <span className='inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-[11px] font-medium text-success-text'>
            {intl.formatMessage(
              {
                id: 'lineage.funnel.tokensSaved',
                defaultMessage: '~{tokens} tokens 省下',
              },
              { tokens: intl.formatNumber(funnel.tokensSaved) }
            )}
            <InfoTooltip
              label={intl.formatMessage({
                id: 'lineage.funnel.tokensSaved.tip',
                defaultMessage:
                  '因为只给了「一句话目录」、没把全文塞进去，又一直没被点开，少花了大约这么多 token。没有用量数据时这一项不显示。',
              })}
            />
          </span>
        </div>
      )}
    </div>
  )
}
