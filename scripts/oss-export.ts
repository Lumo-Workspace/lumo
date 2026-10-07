/**
 * LUM-1034: export a default-deny open-source snapshot of a git ref.
 *
 *   npm run oss:export -- <git-ref> <out-dir> [--manifest oss/manifest.json]
 *
 * Reads the TREE OF THE REF (git ls-tree / git archive), never the working
 * tree, so uncommitted or untracked files cannot end up in the snapshot. The
 * manifest and overlay are read from the working tree, so the export rules can
 * be iterated on before they are committed.
 *
 * Fails (exit 1, nothing left in <out-dir>) when:
 *   - a tracked file is in neither the include nor the exclude list;
 *   - an exported code file imports an excluded file;
 *   - a config file (package.json scripts, husky hooks, …) names a file the
 *     snapshot does not contain;
 *   - a forbidden marker (excluded path names, internal domains, prod hosts)
 *     appears anywhere in the exported text.
 * See oss/manifest.json for the rules and their reasons.
 */
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import {
  applyTransform,
  classifyFiles,
  extractPathTokens,
  findImportViolations,
  isOutsideDir,
  scanMarkers,
  summarizePaths,
  type MarkerHit,
  type OssManifest,
} from './oss-export/manifest'

function out(line = ''): void {
  process.stdout.write(`${line}\n`)
}

class ExportError extends Error {
  constructor(readonly lines: string[]) {
    super(lines[0])
  }
}

function fail(lines: string[]): never {
  throw new ExportError(lines)
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
}

function listFilesRecursive(root: string, prefix = ''): string[] {
  const result: string[] = []
  for (const entry of readdirSync(join(root, prefix), {
    withFileTypes: true,
  })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) result.push(...listFilesRecursive(root, rel))
    else result.push(rel)
  }
  return result
}

function copyPreserving(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true })
  const st = lstatSync(src)
  if (st.isSymbolicLink()) {
    symlinkSync(readlinkSync(src), dest)
    return
  }
  copyFileSync(src, dest)
  chmodSync(dest, st.mode & 0o777)
}

function isProbablyText(buf: Buffer): boolean {
  return !buf.subarray(0, 8000).includes(0)
}

function parseArgs(argv: string[]) {
  const positional: string[] = []
  let manifestPath = 'oss/manifest.json'
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--manifest') manifestPath = argv[++i] ?? manifestPath
    else positional.push(a)
  }
  const [ref, outDir] = positional
  if (!ref || !outDir)
    fail([
      'usage: npm run oss:export -- <git-ref> <out-dir> [--manifest <path>]',
    ])
  return { ref, outDir, manifestPath }
}

function main(): void {
  const { ref, outDir, manifestPath } = parseArgs(process.argv.slice(2))
  const repo = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim()
  const outAbs = resolve(outDir)

  if (!isOutsideDir(repo, outAbs))
    fail([`out-dir must be outside the repository: ${outAbs}`])
  if (existsSync(outAbs) && readdirSync(outAbs).length > 0)
    fail([`out-dir must be empty or absent: ${outAbs}`])

  const sha = git(repo, ['rev-parse', '--verify', `${ref}^{commit}`]).trim()
  const manifest = JSON.parse(
    readFileSync(join(repo, manifestPath), 'utf8')
  ) as OssManifest

  // 1. Classify every tracked file of the ref (default deny).
  const files = git(repo, ['ls-tree', '-r', '-z', '--name-only', sha])
    .split('\0')
    .filter(Boolean)
  const cls = classifyFiles(files, manifest)
  if (cls.unclassified.length > 0)
    fail([
      `✗ ${cls.unclassified.length} tracked file(s) at ${sha.slice(0, 9)} are not classified by ${manifestPath}.`,
      '  Add each path to `include` (public) or `exclude` (stays private) first:',
      ...summarizePaths(cls.unclassified).map(p => `    ${p}`),
    ])
  for (const r of cls.unusedRules)
    out(`⚠ manifest rule matches nothing at this ref: ${r.glob}`)

  const staging = mkdtempSync(join(tmpdir(), 'lumo-oss-export-'))
  let wroteOut = false
  try {
    // 2. Materialize the ref (not the working tree) into a private staging dir.
    const tarPath = join(staging, 'ref.tar')
    execFileSync('git', [
      '-C',
      repo,
      'archive',
      '--format=tar',
      `--output=${tarPath}`,
      sha,
    ])
    const tree = join(staging, 'tree')
    mkdirSync(tree)
    execFileSync('tar', ['-xf', tarPath, '-C', tree])

    // 3. Exported code must not import anything that stays private.
    const violations = findImportViolations(cls.included, cls.excluded, p =>
      readFileSync(join(tree, p), 'utf8')
    )
    if (violations.length > 0)
      fail([
        `✗ ${violations.length} exported file(s) import excluded files. Exclude the importer too, or decouple it:`,
        ...violations.map(v => `    ${v.from} → ${v.target}`),
      ])

    // 4. Copy included files, then overlay, then transforms.
    mkdirSync(outAbs, { recursive: true })
    wroteOut = true
    for (const f of cls.included) copyPreserving(join(tree, f), join(outAbs, f))
    const overlayFiles: string[] = []
    if (manifest.overlayDir) {
      const overlayRoot = join(repo, manifest.overlayDir)
      for (const f of listFilesRecursive(overlayRoot)) {
        const dest = join(outAbs, f)
        rmSync(dest, { force: true })
        copyPreserving(join(overlayRoot, f), dest)
        overlayFiles.push(f)
      }
    }
    for (const t of manifest.transforms ?? []) {
      const p = join(outAbs, t.file)
      if (!existsSync(p))
        fail([
          `✗ transform target is not in the snapshot: ${t.file} (${t.type})`,
        ])
      writeFileSync(p, applyTransform(readFileSync(p, 'utf8'), t))
    }

    // 5. Config files must only reference files that exist in the snapshot.
    const danglingRefs: string[] = []
    for (const cfg of manifest.configRefFiles ?? []) {
      const p = join(outAbs, cfg)
      if (!existsSync(p)) {
        danglingRefs.push(`${cfg} (config file itself missing)`)
        continue
      }
      const base = dirname(cfg)
      for (const token of extractPathTokens(readFileSync(p, 'utf8'))) {
        const candidates = [token, join(base, token)]
        if (!candidates.some(c => existsSync(join(outAbs, c))))
          danglingRefs.push(`${cfg} → ${token}`)
      }
    }
    if (danglingRefs.length > 0)
      fail([
        '✗ snapshot config references files the snapshot does not contain:',
        ...danglingRefs.map(d => `    ${d}`),
      ])

    // 6. Forbidden markers anywhere in exported text.
    const hits: MarkerHit[] = []
    for (const f of listFilesRecursive(outAbs)) {
      const p = join(outAbs, f)
      if (lstatSync(p).isSymbolicLink()) continue
      const buf = readFileSync(p)
      if (!isProbablyText(buf)) continue
      hits.push(
        ...scanMarkers(f, buf.toString('utf8'), manifest.forbiddenMarkers ?? [])
      )
    }
    if (hits.length > 0)
      fail([
        `✗ ${hits.length} forbidden marker hit(s) in the snapshot (file:line [marker]):`,
        ...hits.map(h => `    ${h.file}:${h.line} [${h.markerId}]`),
      ])

    wroteOut = false // success: keep the snapshot
    out(`✓ OSS snapshot of ${sha} → ${outAbs}`)
    out(
      `  tracked ${files.length} · exported ${cls.included.length} · excluded ${cls.excluded.length} · overlay ${overlayFiles.length} · transforms ${(manifest.transforms ?? []).length}`
    )
    out(
      `  checks: 0 unclassified · 0 import violations · 0 dangling config refs · 0 marker hits (${(manifest.forbiddenMarkers ?? []).length} markers)`
    )
  } finally {
    rmSync(staging, { recursive: true, force: true })
    // Never leave a half-checked snapshot behind: it could be published by
    // mistake.
    if (wroteOut) rmSync(outAbs, { recursive: true, force: true })
  }
}

try {
  main()
} catch (err) {
  if (!(err instanceof ExportError)) throw err
  process.stderr.write(`${err.lines.join('\n')}\n`)
  process.exitCode = 1
}
