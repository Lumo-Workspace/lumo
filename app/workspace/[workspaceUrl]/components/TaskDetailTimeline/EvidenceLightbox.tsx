'use client'

import { useIntl } from 'react-intl'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  evidenceLabel,
  type EvidenceFile,
} from '@/shared/src/test-case-evidence'

/**
 * LUM-1011: 一条 run 的图片证据灯箱。
 *
 * 缩略图 96px 宽，看不清截图里的字；开新标签页又要来回切、一次只看一张。
 * 灯箱在原地放大，←/→ 在**这条 run 的全部图片**之间切换（不只是某一步挂的
 * 那几张），「打开原图」仍走新标签页，保留浏览器自带的缩放 / 另存。
 *
 * 受控组件：`index === null` 即关闭。纯渲染，不发请求。
 */
export function EvidenceLightbox({
  images,
  index: requestedIndex,
  onIndexChange,
  onClose,
}: {
  images: EvidenceFile[]
  index: number | null
  onIndexChange: (index: number) => void
  onClose: () => void
}) {
  const intl = useIntl()
  // 打开期间图片列表可能变短（证据被重新拉取）：越界就钳到最后一张。
  const index =
    requestedIndex === null
      ? null
      : Math.min(requestedIndex, Math.max(images.length - 1, 0))
  const current = index === null ? null : (images[index] ?? null)
  const hasPrev = index !== null && index > 0
  const hasNext = index !== null && index < images.length - 1

  const go = (delta: number) => {
    if (index === null) return
    const next = index + delta
    if (next >= 0 && next < images.length) onIndexChange(next)
  }

  return (
    <Dialog open={current !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent
        data-testid='evidence-lightbox'
        className='max-w-5xl gap-3 p-4 sm:p-5'
        onKeyDown={e => {
          if (e.key === 'ArrowLeft') {
            e.preventDefault()
            go(-1)
          } else if (e.key === 'ArrowRight') {
            e.preventDefault()
            go(1)
          }
        }}
      >
        {current && index !== null ? (
          <>
            <div className='flex items-baseline gap-3 pr-8'>
              <DialogTitle className='min-w-0 truncate text-body-strong'>
                {evidenceLabel(current)}
              </DialogTitle>
              <DialogDescription className='shrink-0 text-caption tabular-nums'>
                {intl.formatMessage(
                  { id: 'testCases.lightbox.position' },
                  { current: index + 1, total: images.length }
                )}
              </DialogDescription>
            </div>

            <div className='relative flex items-center justify-center rounded-md bg-muted/40'>
              {/* blob 上的证据图 —— 与缩略图同一约定，用 img 不动 remotePatterns。 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={current.url}
                src={current.url}
                alt={evidenceLabel(current)}
                referrerPolicy='no-referrer'
                className='max-h-[75vh] w-auto max-w-full object-contain'
              />
              {images.length > 1 ? (
                <>
                  <NavButton
                    side='left'
                    disabled={!hasPrev}
                    label={intl.formatMessage({
                      id: 'testCases.lightbox.prev',
                    })}
                    onClick={() => go(-1)}
                  />
                  <NavButton
                    side='right'
                    disabled={!hasNext}
                    label={intl.formatMessage({
                      id: 'testCases.lightbox.next',
                    })}
                    onClick={() => go(1)}
                  />
                </>
              ) : null}
            </div>

            <a
              href={current.url}
              target='_blank'
              rel='noopener noreferrer'
              className='inline-flex items-center gap-1 justify-self-start text-caption text-muted-foreground hover:text-foreground'
            >
              <ExternalLink className='size-3' aria-hidden />
              {intl.formatMessage({ id: 'testCases.lightbox.openOriginal' })}
            </a>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function NavButton({
  side,
  disabled,
  label,
  onClick,
}: {
  side: 'left' | 'right'
  disabled: boolean
  label: string
  onClick: () => void
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <button
      type='button'
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`absolute top-1/2 -translate-y-1/2 ${side === 'left' ? 'left-2' : 'right-2'} rounded-full border border-border bg-background/90 p-1.5 text-foreground transition-opacity hover:bg-background disabled:pointer-events-none disabled:opacity-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
    >
      <Icon className='size-4' aria-hidden />
    </button>
  )
}
