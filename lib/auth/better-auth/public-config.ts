'use client'

/**
 * LUM-1027 / LUM-1082 — the instance's public sign-in options (GET
 * /api/auth/lumo/config), read at runtime so a prebuilt image follows its env.
 * `undefined` while loading; `null` when the request failed (callers then
 * fall back to the pre-LUM-1082 behaviour: the password form).
 */
import { useEffect, useState } from 'react'
import { getAuthClient } from './auth-client'
import type { PublicAuthConfig } from './config'

export type LoadedPublicAuthConfig = PublicAuthConfig | null | undefined

export function usePublicAuthConfig(): LoadedPublicAuthConfig {
  const [config, setConfig] = useState<LoadedPublicAuthConfig>(undefined)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { data } = await getAuthClient().$fetch<PublicAuthConfig>(
          '/lumo/config',
          { method: 'GET' }
        )
        if (!cancelled) setConfig(data ?? null)
      } catch {
        if (!cancelled) setConfig(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return config
}

/**
 * Password sign-in is on unless the server says otherwise (an older server
 * sends no flag); the email code only when the server offers it.
 */
export function passwordEnabledIn(config: LoadedPublicAuthConfig): boolean {
  return config?.passwordEnabled !== false
}

export function emailCodeEnabledIn(config: LoadedPublicAuthConfig): boolean {
  return config?.emailCodeEnabled === true
}
