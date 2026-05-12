import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { lumoOnboardingService } from '@/lib/services/lumo-proposal/lumo-onboarding.service'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumo-onboard-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('lumoOnboardingService.checkStatus', () => {
  it('returns all false when repo is empty', () => {
    const status = lumoOnboardingService.checkStatus(tmpDir)
    expect(status).toEqual({
      lumoMdExists: false,
      claudeMdImported: false,
      agentsMdExists: false,
      agentsMdImported: false,
    })
  })

  it('detects existing LUMO.md', () => {
    fs.writeFileSync(path.join(tmpDir, 'LUMO.md'), '# LUMO.md\n')
    const status = lumoOnboardingService.checkStatus(tmpDir)
    expect(status.lumoMdExists).toBe(true)
  })

  it('detects @import in CLAUDE.md', () => {
    fs.writeFileSync(path.join(tmpDir, 'LUMO.md'), '# LUMO.md\n')
    fs.writeFileSync(
      path.join(tmpDir, 'CLAUDE.md'),
      '# CLAUDE.md\n@import LUMO.md\n'
    )
    const status = lumoOnboardingService.checkStatus(tmpDir)
    expect(status.claudeMdImported).toBe(true)
  })

  it('detects AGENTS.md exists but no import', () => {
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '# AGENTS.md\n')
    const status = lumoOnboardingService.checkStatus(tmpDir)
    expect(status.agentsMdExists).toBe(true)
    expect(status.agentsMdImported).toBe(false)
  })
})

describe('lumoOnboardingService.perform', () => {
  it('creates LUMO.md with template when it does not exist', () => {
    const result = lumoOnboardingService.perform(tmpDir, ['CLAUDE.md'])
    expect(result.created).toContain('LUMO.md')
    const content = fs.readFileSync(path.join(tmpDir, 'LUMO.md'), 'utf-8')
    expect(content).toContain('## Traps')
    expect(content).toContain('## Decisions')
    expect(content).toContain('## Conventions')
    expect(content).toContain('## Procedures')
  })

  it('creates CLAUDE.md with @import when it does not exist', () => {
    const result = lumoOnboardingService.perform(tmpDir, ['CLAUDE.md'])
    expect(result.created).toContain('CLAUDE.md')
    const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf-8')
    expect(content).toContain('@import LUMO.md')
  })

  it('appends @import to existing CLAUDE.md', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# My Project\n')
    const result = lumoOnboardingService.perform(tmpDir, ['CLAUDE.md'])
    expect(result.modified).toContain('CLAUDE.md')
    const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf-8')
    expect(content).toContain('# My Project')
    expect(content).toContain('@import LUMO.md')
  })

  it('skips CLAUDE.md if already imported', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'CLAUDE.md'),
      '# Project\n@import LUMO.md\n'
    )
    fs.writeFileSync(path.join(tmpDir, 'LUMO.md'), '# LUMO.md\n')
    const result = lumoOnboardingService.perform(tmpDir, ['CLAUDE.md'])
    expect(result.skipped).toContain('CLAUDE.md')
    expect(result.skipped).toContain('LUMO.md')
  })

  it('handles both targets', () => {
    const result = lumoOnboardingService.perform(tmpDir, [
      'CLAUDE.md',
      'AGENTS.md',
    ])
    expect(result.created).toContain('LUMO.md')
    expect(result.created).toContain('CLAUDE.md')
    expect(result.created).toContain('AGENTS.md')
  })
})
