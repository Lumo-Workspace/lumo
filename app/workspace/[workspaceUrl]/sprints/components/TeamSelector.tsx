'use client'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ApiTeam } from '@/lib/api-client'

interface TeamSelectorProps {
  teams: ApiTeam[]
  value: string | null
  onChange: (id: string) => void
}

export function TeamSelector({ teams, value, onChange }: TeamSelectorProps) {
  // Nothing to switch between — hide the selector entirely.
  if (teams.length <= 1) return null

  if (teams.length <= 3) {
    return (
      <Tabs value={value ?? ''} onValueChange={onChange}>
        <TabsList>
          {teams.map(t => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.name}
              {!t.sprintsEnabled && (
                <span className='ml-2 text-xs text-muted-foreground'>
                  (disabled)
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    )
  }

  const selectValue = value ?? ''

  return (
    <Select value={selectValue} onValueChange={onChange}>
      <SelectTrigger className='w-64'>
        <SelectValue placeholder='Select team' />
      </SelectTrigger>
      <SelectContent>
        {teams.map(t => (
          <SelectItem key={t.id} value={t.id}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
