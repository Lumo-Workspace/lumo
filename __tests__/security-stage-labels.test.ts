/** @jest-environment node */
// LUM-763: the scan's five layers are stored under internal keys
// (`secrets` / `external` / `supplyChain` / `judge` / `hunt`) and rendered
// under human labels. These two facts must not drift: the keys are the
// persisted contract (historical `stages` JSON, the task-status API, older
// CLIs), and every one of them must resolve to a label on every surface —
// a layer that silently loses its label would vanish from the line, which is
// the fail-open the P9 rule exists to stop.
import fs from 'fs'
import path from 'path'

import {
  SCAN_STAGE_KEYS,
  SCAN_STAGE_STATES,
  scanStageLabel,
  scanStageStateLabel,
} from '@/shared/src/security-scan'

const LOCALE_DIR = path.join(process.cwd(), 'lib/i18n')

const localeFiles = fs
  .readdirSync(LOCALE_DIR)
  .filter(f => f.endsWith('.json'))
  .sort()

describe('LUM-763 — stored stage keys vs rendered labels', () => {
  it('LUM-763: the five stored stage keys are unchanged and every one resolves to a label', () => {
    // The literal list, not a comparison against the current source — a
    // rename of the persisted key must fail this, whichever direction it
    // happens in.
    expect([...SCAN_STAGE_KEYS]).toEqual([
      'secrets',
      'external',
      'supplyChain',
      'judge',
      'hunt',
    ])

    for (const key of SCAN_STAGE_KEYS) {
      const label = scanStageLabel(key)
      expect(label).toBeTruthy()
      expect(label).not.toBe(key)
    }

    for (const state of SCAN_STAGE_STATES) {
      expect(scanStageStateLabel(state)).toBeTruthy()
    }
  })

  it('an unknown key or state falls back to the raw value rather than rendering empty', () => {
    expect(scanStageLabel('somethingNew')).toBe('somethingNew')
    expect(scanStageStateLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW')
  })

  it('LUM-763: every locale carries real securityScan stage and state labels', () => {
    expect(localeFiles.length).toBeGreaterThanOrEqual(16)

    const required = [
      ...SCAN_STAGE_KEYS.map(k => `securityScan.stage.${k}`),
      ...SCAN_STAGE_STATES.map(s => `securityScan.stageState.${s}`),
    ]

    for (const file of localeFiles) {
      const messages = JSON.parse(
        fs.readFileSync(path.join(LOCALE_DIR, file), 'utf8')
      ) as Record<string, string>
      for (const key of required) {
        const value = messages[key]
        if (!value) throw new Error(`${file} is missing ${key}`)
        // `npm run i18n:sync` back-fills with `[TODO:<locale>] …`; shipping
        // one means that locale is reading English (CLAUDE.md i18n rule).
        if (value.includes('[TODO:')) {
          throw new Error(`${file}:${key} is still an i18n:sync placeholder`)
        }
      }
    }
  })
})
