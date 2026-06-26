/** @jest-environment jsdom */
import fs from 'fs'
import path from 'path'
import { render, screen } from '@testing-library/react'
import { DescriptionReadOnly } from '@/app/workspace/[workspaceUrl]/components/DescriptionReadOnly'

const COMPONENTS_DIR = path.join(
  process.cwd(),
  'app/workspace/[workspaceUrl]/components'
)
const WORKSPACE_DIR = path.join(process.cwd(), 'app/workspace')
const LAZY_WRAPPER = 'DescriptionEditorLazy.tsx'
const REAL_MODULE = 'DescriptionEditor.tsx'

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(full)
  }
  return out
}

// Matches an import whose source path is the heavy editor module
// (".../DescriptionEditor"), but NOT the lazy wrapper (".../DescriptionEditorLazy").
// Checked per-line because the codebase omits statement semicolons.
const REAL_EDITOR_IMPORT = /\bfrom\s+['"][^'"]*\/DescriptionEditor['"]/

describe('LUM-283 lazy DescriptionEditor', () => {
  test('lazy loads DescriptionEditor and keeps it out of first load static imports', () => {
    const offenders: string[] = []
    for (const file of walk(WORKSPACE_DIR)) {
      const base = path.basename(file)
      if (base === LAZY_WRAPPER || base === REAL_MODULE) continue
      const lines = fs
        .readFileSync(file, 'utf8')
        // neutralise the wrapper path so it can't match the real-module regex
        .replace(/DescriptionEditorLazy/g, 'DescriptionEditorWRAPPER')
        .split('\n')
      if (lines.some(line => REAL_EDITOR_IMPORT.test(line))) {
        offenders.push(path.relative(process.cwd(), file))
      }
    }
    // Nothing outside the lazy wrapper may import the heavy editor module —
    // a single static importer keeps the whole stack in the first-load graph.
    expect(offenders).toEqual([])

    // The wrapper code-splits the editor with next/dynamic(ssr:false) and feeds
    // the current value into a read-only fallback while the chunk downloads.
    const wrapper = fs.readFileSync(
      path.join(COMPONENTS_DIR, LAZY_WRAPPER),
      'utf8'
    )
    expect(wrapper).toMatch(/from ['"]next\/dynamic['"]/)
    expect(wrapper).toMatch(/ssr:\s*false/)
    expect(wrapper).toMatch(/import\(\s*['"]\.\/DescriptionEditor['"]\s*\)/)
    expect(wrapper).toMatch(/DescriptionReadOnly/)
  })

  test('renders description HTML read only as a lightweight fallback', () => {
    render(<DescriptionReadOnly html={'<p>Existing description</p>'} />)
    expect(screen.getByText('Existing description')).toBeInTheDocument()

    // Empty value falls back to the placeholder, never a blank box.
    const { container } = render(
      <DescriptionReadOnly html={null} placeholder={'No description yet'} />
    )
    expect(container.textContent).toContain('No description yet')
  })
})
