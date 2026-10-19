'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'

import { Badges } from './sections/Badges'
import { Buttons } from './sections/Buttons'
import { ColorTokens } from './sections/ColorTokens'
import { Elevation } from './sections/Elevation'
import { Inputs } from './sections/Inputs'
import { Motion } from './sections/Motion'
import { Spacing } from './sections/Spacing'
import { StatusAndPriority } from './sections/StatusAndPriority'
import { TypographyScale } from './sections/TypographyScale'

const NAV = [
  { id: 'colors', label: 'Colors' },
  { id: 'typography', label: 'Typography' },
  { id: 'elevation', label: 'Elevation' },
  { id: 'motion', label: 'Motion' },
  { id: 'spacing', label: 'Spacing' },
  { id: 'buttons', label: 'Button' },
  { id: 'badges', label: 'Badge' },
  { id: 'inputs', label: 'Form fields' },
  { id: 'status-priority', label: 'Status & priority' },
]

function ThemeToggle() {
  const [mounted, setMounted] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()

  useEffect(() => {
    setMounted(true) // eslint-disable-line react-hooks/set-state-in-effect
  }, [])

  if (!mounted) return null

  const next = resolvedTheme === 'dark' ? 'light' : 'dark'
  return (
    <Button variant='outline' size='sm' onClick={() => setTheme(next)}>
      {resolvedTheme === 'dark' ? 'Light' : 'Dark'} mode
    </Button>
  )
}

export function DesignSystemCatalog() {
  return (
    <div className='mx-auto flex max-w-5xl gap-10 px-6 py-10'>
      <nav className='sticky top-10 hidden h-fit w-40 shrink-0 flex-col gap-1 lg:flex'>
        {NAV.map(item => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className='text-body text-muted-foreground hover:text-foreground'
          >
            {item.label}
          </a>
        ))}
      </nav>
      <main className='min-w-0 flex-1'>
        <header className='mb-6 flex items-center justify-between'>
          <h1 className='text-display text-foreground'>Design System</h1>
          <ThemeToggle />
        </header>
        <ColorTokens />
        <TypographyScale />
        <Elevation />
        <Motion />
        <Spacing />
        <Buttons />
        <Badges />
        <Inputs />
        <StatusAndPriority />
      </main>
    </div>
  )
}
