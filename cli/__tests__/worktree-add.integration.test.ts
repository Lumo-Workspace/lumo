/**
 * @jest-environment node
 */
/**
 * LUM-825: `lumo worktree add` against real git repos shaped like a customer's
 * — a `master` default branch, no node_modules, no husky, no config — plus a
 * repo that opts into behaviour through `.lumo/worktree.json`.
 */
import * as fs from 'fs'
import * as path from 'path'
import { worktreeAdd } from '../src/commands/worktree-add'
import { parseWorktreeConfig } from '../src/lib/worktree-config'
import {
  captureOutput,
  git,
  inDir,
  isolateGitEnv,
  makeSandbox,
  type Sandbox,
} from '../test-support/real-git'

let restoreEnv: () => void
let sb: Sandbox

beforeAll(() => {
  restoreEnv = isolateGitEnv()
})
afterAll(() => restoreEnv())
beforeEach(() => {
  sb = makeSandbox('master')
})
afterEach(() => sb.cleanup())

describe('worktree add (real git)', () => {
  it('bases the branch on the remote default branch when it is not main', async () => {
    // Move the remote ahead so "branched off the fetched origin/master" is
    // observable: the worktree must start at the new remote tip.
    const other = path.join(sb.tmp, 'other')
    git(sb.tmp, 'clone', '-q', sb.remote, other)
    fs.writeFileSync(path.join(other, 'b.txt'), 'b\n')
    git(other, 'add', 'b.txt')
    git(other, 'commit', '-q', '-m', 'second')
    git(other, 'push', '-q', 'origin', 'master')
    const remoteTip = git(sb.remote, 'rev-parse', 'master')

    const { result, err } = await captureOutput(() =>
      inDir(sb.main, () => worktreeAdd('LUM-7', 'feature', {}))
    )
    expect(err).toBe('')
    expect(result).toBe(0)
    const dir = path.join(sb.main, '.worktrees', 'LUM-7-feature')
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(
      'lumo/LUM-7-feature'
    )
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(remoteTip)
    // No `main` exists anywhere in this repo.
    expect(git(sb.main, 'branch', '-a')).not.toMatch(/\bmain\b/)

    // --base still overrides detection.
    git(sb.main, 'branch', 'develop', 'HEAD~0')
    const initial = git(sb.main, 'rev-parse', 'master')
    const second = await captureOutput(() =>
      inDir(sb.main, () => worktreeAdd('LUM-8', undefined, { base: 'develop' }))
    )
    expect(second.result).toBe(0)
    expect(
      git(path.join(sb.main, '.worktrees', 'LUM-8'), 'rev-parse', 'HEAD')
    ).toBe(initial)
  })

  it('prints no Lumo-repo guidance in a plain non-Node repo and keeps git status clean', async () => {
    const { result, out, err } = await captureOutput(() =>
      inDir(sb.main, () => worktreeAdd('LUM-9', undefined, {}))
    )
    expect(result).toBe(0)
    const all = `${out}\n${err}`
    expect(all).not.toMatch(/npm install/i)
    expect(all).not.toMatch(/husky/i)
    expect(all).not.toMatch(/prisma/i)
    expect(all).not.toMatch(/jest/i)
    expect(all).not.toMatch(/node_modules/i)
    expect(all).not.toMatch(/hooks will NOT run/i)
    expect(err).toBe('')

    const dir = path.join(sb.main, '.worktrees', 'LUM-9')
    expect(fs.existsSync(path.join(dir, 'node_modules'))).toBe(false)
    expect(git(sb.main, 'status', '--porcelain')).toBe('')
    const exclude = fs.readFileSync(
      path.join(sb.main, '.git', 'info', 'exclude'),
      'utf8'
    )
    expect(exclude).toContain('/.worktrees/')
    // The tracked .gitignore is never created or edited.
    expect(fs.existsSync(path.join(sb.main, '.gitignore'))).toBe(false)
  })

  it('applies linkPaths, copyPaths, notes and verifyCommand from .lumo/worktree.json', async () => {
    fs.mkdirSync(path.join(sb.main, 'vendor-cache'))
    fs.writeFileSync(path.join(sb.main, 'vendor-cache', 'x'), 'x')
    fs.mkdirSync(path.join(sb.main, 'hooks-shim'))
    fs.writeFileSync(path.join(sb.main, 'hooks-shim', 'h'), 'h')
    fs.mkdirSync(path.join(sb.main, '.lumo'))
    fs.writeFileSync(
      path.join(sb.main, '.lumo', 'worktree.json'),
      JSON.stringify({
        linkPaths: ['vendor-cache'],
        copyPaths: ['hooks-shim'],
        notes: ['REPO-NOTE-1'],
        verifyCommand: 'touch verified.txt',
      })
    )
    const { result, out } = await captureOutput(() =>
      inDir(sb.main, () => worktreeAdd('LUM-10', undefined, { verify: true }))
    )
    expect(result).toBe(0)
    const dir = path.join(sb.main, '.worktrees', 'LUM-10')
    expect(fs.lstatSync(path.join(dir, 'vendor-cache')).isSymbolicLink()).toBe(
      true
    )
    const copied = fs.lstatSync(path.join(dir, 'hooks-shim'))
    expect(copied.isDirectory() && !copied.isSymbolicLink()).toBe(true)
    expect(out).toContain('REPO-NOTE-1')
    expect(fs.existsSync(path.join(dir, 'verified.txt'))).toBe(true)

    // This repo's own config reproduces the pre-LUM-825 hard-coded behaviour.
    const own = fs.readFileSync(
      path.resolve(__dirname, '../../.lumo/worktree.json'),
      'utf8'
    )
    const parsed = parseWorktreeConfig(own)
    expect(parsed.problems).toEqual([])
    expect(parsed.config.linkPaths).toEqual(['node_modules'])
    expect(parsed.config.copyPaths).toEqual(['.husky/_'])
    expect(parsed.config.verifyCommand).toBe('npx jest')
    expect(parsed.config.autoWorktree).toBe(true)
    const notes = (parsed.config.notes ?? []).join('\n')
    expect(notes).toMatch(/prisma generate/)
    expect(notes).toMatch(/jest/)
  })

  it('copies the husky shim only when core.hooksPath points into .husky', async () => {
    fs.mkdirSync(path.join(sb.main, '.husky', '_'), { recursive: true })
    fs.writeFileSync(path.join(sb.main, '.husky', '_', 'h'), '#!/bin/sh\n')
    git(sb.main, 'config', 'core.hooksPath', '.husky/_')
    const { result } = await captureOutput(() =>
      inDir(sb.main, () => worktreeAdd('LUM-11', undefined, {}))
    )
    expect(result).toBe(0)
    expect(
      fs.existsSync(
        path.join(sb.main, '.worktrees', 'LUM-11', '.husky', '_', 'h')
      )
    ).toBe(true)
  })

  it('asks for --base when the default branch cannot be determined', async () => {
    git(sb.main, 'remote', 'remove', 'origin')
    const { result, err } = await captureOutput(() =>
      inDir(sb.main, () => worktreeAdd('LUM-12', undefined, { noFetch: true }))
    )
    expect(result).toBe(1)
    expect(err).toMatch(/--base/)
  })
})
