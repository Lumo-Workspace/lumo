/**
 * PURE — LUM-1150 follow-up: does a committable suggestion only use names
 * that are in scope in its file?
 *
 * GitHub commits a suggestion as-is, so one that calls a function its file
 * never imports breaks the author's build (production: `execFile(...)`
 * suggested in a file importing only `exec`). This is a cheap lexical check,
 * not a compiler: it lists the names the suggestion CALLS (`foo(`) or uses as
 * a member-access root (`foo.bar`) that are neither
 *   · anywhere in the file's code (comments and strings stripped),
 *   · declared by the suggestion itself (an import, a const, a parameter…),
 *   · nor a language keyword or built-in.
 * Any name listed ⇒ the caller drops the suggestion (the comment stays). It
 * errs towards dropping: when only the PR's added lines of the file are
 * known, an import outside them reads as unknown.
 */

const IDENT = '[A-Za-z_$][\\w$]*'

/** Languages whose line comments start with `#` (and have no `//`). */
const HASH_COMMENT_FILE = /\.(py|pyi|rb|sh|bash|zsh|ya?ml|toml|r|pl|ex|exs)$/i

const KEYWORDS = new Set([
  // JS / TS
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'catch',
  'try',
  'finally',
  'return',
  'throw',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'function',
  'class',
  'extends',
  'super',
  'this',
  'await',
  'async',
  'yield',
  'import',
  'export',
  'from',
  'as',
  'const',
  'let',
  'var',
  'type',
  'interface',
  'enum',
  'satisfies',
  'keyof',
  'readonly',
  'declare',
  'with',
  'true',
  'false',
  'null',
  'undefined',
  'NaN',
  'Infinity',
  // Python
  'def',
  'elif',
  'lambda',
  'and',
  'or',
  'not',
  'is',
  'assert',
  'pass',
  'raise',
  'except',
  'global',
  'nonlocal',
  'None',
  'True',
  'False',
  'self',
  'cls',
  'print',
  // Go / Rust / Java / C-family
  'func',
  'fn',
  'go',
  'defer',
  'chan',
  'select',
  'range',
  'match',
  'impl',
  'sizeof',
  'struct',
  'package',
  'public',
  'private',
  'protected',
  'static',
])

const BUILTINS = new Set([
  // JS / TS / Node / web
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'Symbol',
  'BigInt',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'WeakRef',
  'Promise',
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'AggregateError',
  'Date',
  'RegExp',
  'JSON',
  'Math',
  'Reflect',
  'Proxy',
  'Intl',
  'URL',
  'URLSearchParams',
  'fetch',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'queueMicrotask',
  'structuredClone',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURIComponent',
  'decodeURIComponent',
  'encodeURI',
  'decodeURI',
  'require',
  'module',
  'exports',
  'Buffer',
  'console',
  'process',
  'globalThis',
  'window',
  'document',
  'atob',
  'btoa',
  'AbortController',
  'AbortSignal',
  'TextEncoder',
  'TextDecoder',
  'Headers',
  'Request',
  'Response',
  'FormData',
  'Blob',
  'ArrayBuffer',
  'Uint8Array',
  'Int32Array',
  'Float64Array',
  'DataView',
  'crypto',
  'performance',
  'Event',
  'EventTarget',
  'Iterator',
  'Record',
  'Partial',
  'Pick',
  'Omit',
  'Readonly',
  'ReturnType',
  // Python
  'len',
  'range',
  'str',
  'int',
  'float',
  'bool',
  'list',
  'dict',
  'set',
  'tuple',
  'bytes',
  'open',
  'isinstance',
  'issubclass',
  'getattr',
  'setattr',
  'hasattr',
  'enumerate',
  'zip',
  'map',
  'filter',
  'sorted',
  'reversed',
  'min',
  'max',
  'sum',
  'abs',
  'any',
  'all',
  'repr',
  'iter',
  'next',
  'round',
  'format',
  'id',
  'hash',
  'input',
  'object',
  'vars',
  'dir',
  'callable',
  'divmod',
  'pow',
  'ord',
  'chr',
  'hex',
  'bin',
  'frozenset',
  'slice',
  'staticmethod',
  'classmethod',
  'property',
  'ValueError',
  'KeyError',
  'IndexError',
  'Exception',
  'RuntimeError',
  'AttributeError',
  'OSError',
  'NotImplementedError',
  'StopIteration',
  // Go
  'make',
  'cap',
  'append',
  'copy',
  'panic',
  'recover',
  'close',
  'println',
  'complex',
  'real',
  'imag',
  'clear',
  'string',
  'byte',
  'rune',
  'error',
  'int8',
  'int16',
  'int32',
  'int64',
  'uint',
  'uint8',
  'uint16',
  'uint32',
  'uint64',
  'uintptr',
  'float32',
  'float64',
])

/**
 * The code with comments and string / template contents blanked (same
 * length, newlines kept), so names inside them are never read as code.
 */
export function stripCommentsAndStrings(
  code: string,
  filePath: string
): string {
  const hash = HASH_COMMENT_FILE.test(filePath)
  let out = ''
  let i = 0
  while (i < code.length) {
    const c = code[i]!
    const next = code[i + 1]
    if (!hash && c === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') {
        out += ' '
        i++
      }
      continue
    }
    if (!hash && c === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2)
      const stop = end === -1 ? code.length : end + 2
      out += code.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }
    if (hash && c === '#') {
      while (i < code.length && code[i] !== '\n') {
        out += ' '
        i++
      }
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      out += ' '
      i++
      while (i < code.length && code[i] !== c) {
        if (code[i] === '\\') {
          out += ' '
          i++
        }
        // An unterminated '…' / "…" ends at the line; a template may not.
        if (c !== '`' && code[i] === '\n') break
        out += code[i] === '\n' ? '\n' : ' '
        i++
      }
      if (code[i] === c) {
        out += ' '
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
}

function identifiersIn(text: string): string[] {
  return text.match(new RegExp(IDENT, 'g')) ?? []
}

/** Names the suggestion itself brings into scope. Generous on purpose. */
function declaredBy(code: string): Set<string> {
  const declared = new Set<string>()
  const add = (text: string | undefined) => {
    for (const name of identifiersIn(text ?? '')) declared.add(name)
  }
  for (const line of code.split('\n')) {
    // `import …` / `from m import …` / `use …`: every name on the line.
    if (/^\s*(import|from|use)\b/.test(line)) add(line)
  }
  const patterns: RegExp[] = [
    // const / let / var, with or without destructuring.
    new RegExp(
      `\\b(?:const|let|var)\\s+(${IDENT}|\\{[^}]*\\}|\\[[^\\]]*\\])`,
      'g'
    ),
    // Named declarations.
    new RegExp(
      `\\b(?:function\\*?|class|def|func|fn|type|interface|enum)\\s+(${IDENT})`,
      'g'
    ),
    // Parameters: function / def / func parameter lists, arrows, lambdas.
    new RegExp(
      `\\b(?:function\\*?|def|func|fn)\\s*${'(?:' + IDENT + ')?'}\\s*(?:<[^>]*>)?\\s*\\(([^)]*)\\)`,
      'g'
    ),
    /\(([^()]*)\)\s*(?::\s*[^=()]+)?=>/g,
    new RegExp(`(${IDENT})\\s*=>`, 'g'),
    /\blambda\b([^:]*):/g,
    // catch (e), except E as e, with … as f, for x in / of.
    new RegExp(`\\bcatch\\s*\\(\\s*(${IDENT})`, 'g'),
    new RegExp(`\\bas\\s+(${IDENT})`, 'g'),
    /\bfor\s*\(?\s*(?:const|let|var)?\s*([^;]*?)\s+(?:in|of)\b/g,
    // Go short declarations: a, err := …
    new RegExp(`((?:${IDENT}\\s*,\\s*)*${IDENT})\\s*:=`, 'g'),
  ]
  for (const re of patterns) {
    for (const m of code.matchAll(re)) add(m[1])
  }
  return declared
}

/**
 * The names `code` calls or dereferences that are not in scope — empty when
 * the suggestion is safe to commit as far as names go. Sorted, unique.
 *
 * `fileText` is what is known of the file at the PR head: its whole content
 * when it was read, else only the PR's added lines.
 */
export function unknownSuggestionNames(input: {
  code: string
  fileText: string
  filePath: string
}): string[] {
  const code = stripCommentsAndStrings(input.code, input.filePath)
  const known = new Set(
    identifiersIn(stripCommentsAndStrings(input.fileText, input.filePath))
  )
  const declared = declaredBy(code)
  const used = new Set<string>()
  // Not after `.` (a member), `#` (a private field), `@` (a decorator is a
  // call we do not read), or another identifier character.
  const calls = new RegExp(
    `(?<![\\w$.#@])(${IDENT})\\s*(?:<[^<>()]*>)?\\s*\\(`,
    'g'
  )
  const roots = new RegExp(`(?<![\\w$.#@])(${IDENT})\\s*\\??\\.(?![.\\d])`, 'g')
  for (const re of [calls, roots]) {
    for (const m of code.matchAll(re)) used.add(m[1]!)
  }
  return [...used]
    .filter(
      name =>
        !KEYWORDS.has(name) &&
        !BUILTINS.has(name) &&
        !known.has(name) &&
        !declared.has(name)
    )
    .sort()
}
