'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { workspacesClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  PUBLIC_LOCALES,
  PUBLIC_LOCALE_NAMES,
  type PublicLocale,
} from '@/lib/i18n/public-locale'

interface DefaultLanguageRowProps {
  /** The stored `Workspace.defaultLocale`. */
  value: string
  /** Called with the saved value once the server accepts it. */
  onSaved: (locale: string) => void
}

/**
 * LUM-1097 — the workspace's default language: Slack channel posts are
 * written in it, and so are Slack DMs to members who have not picked a
 * language of their own. OWNER-only (the page and the API both enforce it).
 * Languages are listed by their own names, like the language switcher.
 */
export function DefaultLanguageRow({
  value,
  onSaved,
}: DefaultLanguageRowProps) {
  const intl = useIntl()
  const [selected, setSelected] = useState(value)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const data = await workspacesClient.updateMe<{
        workspace: { defaultLocale?: string }
      }>({ defaultLocale: selected })
      const saved = data.workspace.defaultLocale ?? selected
      setSelected(saved)
      onSaved(saved)
      toast.success(
        intl.formatMessage({ id: 'workspaceSettings.defaultLanguageUpdated' })
      )
    } catch (err) {
      setSelected(value)
      toast.error(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              id: 'workspaceSettings.defaultLanguageUpdateFailed',
            })
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='flex items-center justify-between gap-4 px-5 py-4'>
      <div className='min-w-0'>
        <label
          htmlFor='workspace-default-locale'
          className='text-body-strong text-foreground'
        >
          {intl.formatMessage({ id: 'workspaceSettings.defaultLanguage' })}
        </label>
        <p className='text-caption text-muted-foreground mt-0.5'>
          {intl.formatMessage({ id: 'workspaceSettings.defaultLanguageDesc' })}
        </p>
      </div>
      <div className='flex items-center gap-2 shrink-0'>
        <Select value={selected} onValueChange={setSelected} disabled={saving}>
          <SelectTrigger
            id='workspace-default-locale'
            className='h-8 w-auto gap-2 text-foreground'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PUBLIC_LOCALES.map((locale: PublicLocale) => (
              <SelectItem key={locale} value={locale} lang={locale}>
                {PUBLIC_LOCALE_NAMES[locale]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected !== value && (
          <Button size='sm' onClick={handleSave} disabled={saving}>
            {saving
              ? intl.formatMessage({ id: 'common.saving' })
              : intl.formatMessage({ id: 'common.save' })}
          </Button>
        )}
      </div>
    </div>
  )
}
