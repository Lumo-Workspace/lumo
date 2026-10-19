'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Copy, Check } from 'lucide-react'

interface CodeBlockProps {
  lines: string[]
}

export function CodeBlock({ lines }: CodeBlockProps) {
  const intl = useIntl()
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  async function handleCopy(line: string, index: number) {
    await navigator.clipboard.writeText(line)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  return (
    <div className='rounded-md border bg-muted font-mono text-caption overflow-hidden'>
      {lines.map((line, index) => {
        const isCopied = copiedIndex === index
        return (
          <div
            key={index}
            className='flex items-center justify-between gap-3 px-3 py-2 border-b border-border last:border-b-0'
          >
            <div className='flex items-center gap-2 min-w-0'>
              <span className='text-muted-foreground select-none'>$</span>
              <span className='truncate text-foreground'>{line}</span>
            </div>
            <button
              type='button'
              onClick={() => void handleCopy(line, index)}
              aria-label={
                isCopied
                  ? intl.formatMessage({ id: 'cli.copied' })
                  : intl.formatMessage({ id: 'cli.copy' })
              }
              className='shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
            >
              {isCopied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        )
      })}
    </div>
  )
}
