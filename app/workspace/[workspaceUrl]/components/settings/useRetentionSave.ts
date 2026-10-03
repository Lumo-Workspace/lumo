'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { workspacesClient } from '@/lib/api-client'

/**
 * LUM-933 — save one data-retention field set and report it. Returns the
 * saving flag and a `save(patch)` that resolves true on success, so the row
 * can move its "saved" baseline.
 */
export function useRetentionSave() {
  const intl = useIntl()
  const [saving, setSaving] = useState(false)

  const save = async (patch: Record<string, unknown>): Promise<boolean> => {
    setSaving(true)
    try {
      await workspacesClient.updateMe(patch)
      toast.success(intl.formatMessage({ id: 'dataRetention.saved' }))
      return true
    } catch {
      toast.error(intl.formatMessage({ id: 'dataRetention.saveFailed' }))
      return false
    } finally {
      setSaving(false)
    }
  }

  return { saving, save }
}
