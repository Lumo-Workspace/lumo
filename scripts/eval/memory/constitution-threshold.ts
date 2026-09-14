/**
 * LUM-778 — re-check the constitution-redundancy floor
 * (CONSTITUTION_REDUNDANCY_FLOOR = 0.55, cosine-of-character-bigrams) against
 * real-shaped memory samples in BOTH English and Chinese.
 *
 * Offline eval, no gateway, no DB. Reads THIS repo's CLAUDE.md + AGENTS.md
 * from disk as the English constitution (explicitly — this is an eval script,
 * not the product path, which reads the project's linked repo).
 *
 * Groups:
 *   EN-novel      — evalSet candidates (real Lumo topics, rewritten); expect KEEP
 *   EN-restate    — hand paraphrases of CLAUDE.md rules;             expect REJECT
 *   ZH-novel      — Chinese versions of real topics;                 expect KEEP
 *   ZH-restate    — Chinese restatements of CLAUDE.md rules;          expect REJECT
 *   ZH-restate/ZH — the same, but against a CHINESE constitution;     expect REJECT
 *
 * Usage: npx tsx scripts/eval/memory/constitution-threshold.ts
 */
/* eslint-disable no-console */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { MemoryCategory } from '@prisma/client'
import { evalSet } from './eval-set'
import { memoryContentToText } from '../../../lib/memory/content-text'
import { bigramSimilarity } from '../../../lib/similarity'
import { CONSTITUTION_REDUNDANCY_FLOOR } from '../../../lib/services/memory/extraction-gate'

interface Sample {
  id: string
  category: MemoryCategory
  content: unknown
  expect: 'KEEP' | 'REJECT'
}

const root = path.resolve(__dirname, '../../..')
const EN_CONSTITUTION = [
  readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'),
  readFileSync(path.join(root, 'AGENTS.md'), 'utf8'),
].join('\n\n')

/** A Chinese constitution: faithful translations of a few CLAUDE.md rules. */
const ZH_CONSTITUTION = [
  '# CLAUDE.md',
  '## 代码风格',
  '- 使用 async/await，不要用 .then()',
  '- 生产代码中不要有 console.log，使用正式的日志',
  '- 优先使用具名导出，而不是默认导出',
  '- 所有数据库访问都用 Prisma —— 永远不要写原生 SQL',
  '## 测试',
  '- 使用 Jest；测试文件放在 __tests__ 目录',
  '- 每个新函数至少要有一个测试',
  '## Git',
  '- 分支命名：lumo/{task-id}-{short-description}',
  '- 永远不要直接推送到 main 或 develop',
  '## 禁止',
  '- 永远不要删除 prisma/migrations/ 下的文件',
  '- 永远不要硬编码 API key 或密钥',
].join('\n')

// Same line-splitting the gate uses (extraction-gate.ts constitutionLines).
function constitutionLines(constitution: string): string[] {
  return constitution
    .split('\n')
    .map(l => l.replace(/^[\s#>*\-+\d.)|`]+/, '').trim())
    .filter(l => l.length >= 15)
}

const enNovel: Sample[] = evalSet.map(c => ({
  id: c.id,
  category: c.category,
  content: c.candidate,
  expect: 'KEEP',
}))

const enRestate: Sample[] = [
  {
    id: 'en-r-prisma',
    category: 'CONVENTION',
    content: {
      rule: 'Use Prisma for all database access, never raw SQL',
      scope: 'all database code',
    },
    expect: 'REJECT',
  },
  {
    id: 'en-r-console',
    category: 'CONVENTION',
    content: {
      rule: 'No console.log in production code; use proper logging',
      scope: 'server and client code',
    },
    expect: 'REJECT',
  },
  {
    id: 'en-r-exports',
    category: 'CONVENTION',
    content: {
      rule: 'Prefer named exports over default exports',
      scope: 'every module',
    },
    expect: 'REJECT',
  },
  {
    id: 'en-r-branch',
    category: 'PROCEDURAL',
    content: {
      workflow: 'Name branches lumo/{task-id}-{short-description}',
      trigger: 'starting a task',
      steps: ['git checkout -b lumo/LUM-12-add-oauth-login'],
    },
    expect: 'REJECT',
  },
  {
    id: 'en-r-migrations',
    category: 'TRAP',
    content: {
      trigger: 'Deleting files in prisma/migrations/',
      outcome: 'Never delete files in prisma/migrations/ — prod history breaks',
    },
    expect: 'REJECT',
  },
  {
    id: 'en-r-tests',
    category: 'CONVENTION',
    content: {
      rule: 'Every new function needs at least one test',
      scope: 'lib/ and app/',
    },
    expect: 'REJECT',
  },
  {
    id: 'en-r-push-main',
    category: 'CONVENTION',
    content: {
      rule: 'Never push to main or develop directly — always open a PR',
      scope: 'git workflow',
    },
    expect: 'REJECT',
  },
  {
    id: 'en-r-migrate-dev',
    category: 'PROCEDURAL',
    content: {
      workflow:
        'Apply schema changes locally with prisma migrate dev; hand-write the SQL and use prisma migrate resolve when checksum drift (P3008/P3012) blocks it',
      trigger: 'schema change on dev',
    },
    expect: 'REJECT',
  },
]

const zhNovel: Sample[] = [
  {
    id: 'zh-n-vercel-migrate',
    category: 'TRAP',
    content: {
      trigger: '合并含 schema 变更的 PR',
      outcome:
        'Vercel CI 不会自动跑 prisma migrate deploy，线上表结构漂移，接口 500',
      workaround: '部署完成后手动对 prod 执行 prisma migrate deploy',
    },
    expect: 'KEEP',
  },
  {
    id: 'zh-n-slack-retry',
    category: 'TRAP',
    content: {
      trigger: 'Slack webhook 重试三次仍失败',
      outcome: '通知被静默丢弃，没有任何日志',
      workaround: '加一条 dead-letter 日志并告警',
    },
    expect: 'KEEP',
  },
  {
    id: 'zh-n-session-fk',
    category: 'DECISION',
    content: {
      what: 'Session 与 Task 是多对一，用户在一个会话里切任务时按最终任务归档',
      why: '简化数据模型，先跑通主流程',
      implications: '切任务后早期工作的记录会丢失，需要在切换时拆分会话',
    },
    expect: 'KEEP',
  },
  {
    id: 'zh-n-fixture-ignore',
    category: 'CONVENTION',
    content: {
      rule: '大体积生成的 fixture JSON 要加进 .prettierignore，否则 lint 会很慢',
      scope: 'scripts/eval/memory 下的生成数据',
    },
    expect: 'KEEP',
  },
  {
    id: 'zh-n-hook-event',
    category: 'PROCEDURAL',
    content: {
      workflow: '新增 HookEventType 后在时间线 UI 里展示',
      trigger: 'Prisma 枚举新增值',
      steps: [
        '在 types.ts 的联合类型里加事件',
        '在 categorizeHookEvent 里分类',
        '在 PILL_LABEL 里加标签',
        '补一个遍历所有枚举值的测试',
      ],
    },
    expect: 'KEEP',
  },
  {
    id: 'zh-n-worktree-npm',
    category: 'TRAP',
    content: {
      trigger: '在 worktree 里执行 npm install',
      outcome:
        'npm 会删掉 node_modules 软链并重新安装整棵树，共享的 prisma client 丢失',
      workaround: '只在主 checkout 里安装，然后重新建软链',
    },
    expect: 'KEEP',
  },
  {
    id: 'zh-n-drift-check',
    category: 'CONVENTION',
    content: {
      rule: '改 cli/src/commands 时同步更新 SKILL.md，否则 commit-msg 钩子会提示漂移',
      scope: 'CLI 命令改动',
    },
    expect: 'KEEP',
  },
  {
    id: 'zh-n-env-secret',
    category: 'TRAP',
    content: {
      trigger: '.env.production 被 git 跟踪',
      outcome: '历史里能直接读到生产凭据，必须全部轮换并 rebase 清理',
      workaround: '提交前加进 .gitignore，用 secrets manager 管理生产值',
    },
    expect: 'KEEP',
  },
]

const zhRestate: Sample[] = [
  {
    id: 'zh-r-prisma',
    category: 'CONVENTION',
    content: {
      rule: '所有数据库访问都用 Prisma，不要写原生 SQL',
      scope: '全部数据库代码',
    },
    expect: 'REJECT',
  },
  {
    id: 'zh-r-console',
    category: 'CONVENTION',
    content: {
      rule: '生产代码里不要用 console.log，用正式日志',
      scope: '前后端',
    },
    expect: 'REJECT',
  },
  {
    id: 'zh-r-exports',
    category: 'CONVENTION',
    content: { rule: '优先用具名导出，不用默认导出', scope: '所有模块' },
    expect: 'REJECT',
  },
  {
    id: 'zh-r-branch',
    category: 'PROCEDURAL',
    content: {
      workflow: '分支按 lumo/{task-id}-{short-description} 命名',
      trigger: '开始一个任务',
    },
    expect: 'REJECT',
  },
  {
    id: 'zh-r-migrations',
    category: 'TRAP',
    content: {
      trigger: '删除 prisma/migrations/ 下的文件',
      outcome: '永远不要删 prisma/migrations/ 里的文件，会破坏迁移历史',
    },
    expect: 'REJECT',
  },
  {
    id: 'zh-r-tests',
    category: 'CONVENTION',
    content: { rule: '每个新函数至少要有一个测试', scope: 'lib 和 app' },
    expect: 'REJECT',
  },
  {
    id: 'zh-r-push-main',
    category: 'CONVENTION',
    content: { rule: '永远不要直接推送到 main 或 develop', scope: 'git 流程' },
    expect: 'REJECT',
  },
  {
    id: 'zh-r-secrets',
    category: 'CONVENTION',
    content: { rule: '永远不要硬编码 API key 或密钥', scope: '所有代码' },
    expect: 'REJECT',
  },
]

interface Scored {
  id: string
  expect: Sample['expect']
  score: number
  line: string
  containment: boolean
}

function score(samples: Sample[], constitution: string): Scored[] {
  const lines = constitutionLines(constitution)
  return samples.map(s => {
    const text = memoryContentToText(s.category, s.content)
    let best = { score: 0, line: '' }
    for (const line of lines) {
      const v = bigramSimilarity(text, line)
      if (v > best.score) best = { score: v, line }
    }
    const a = text.toLowerCase().trim()
    const b = best.line.toLowerCase().trim()
    return {
      id: s.id,
      expect: s.expect,
      score: best.score,
      line: best.line,
      containment: best.score === 1 && (a.includes(b) || b.includes(a)),
    }
  })
}

function fmt(n: number): string {
  return n.toFixed(2)
}

function report(name: string, rows: Scored[], floor: number): void {
  const scores = rows.map(r => r.score).sort((a, b) => a - b)
  const median = scores[Math.floor(scores.length / 2)] ?? 0
  const mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length)
  const rejected = rows.filter(r => r.score >= floor)
  const wrong = rows.filter(r =>
    r.expect === 'KEEP' ? r.score >= floor : r.score < floor
  )
  console.log(`\n## ${name}  (n=${rows.length}, expect=${rows[0]?.expect})`)
  console.log(
    `max-score over lines — min ${fmt(scores[0] ?? 0)} · median ${fmt(median)} · mean ${fmt(mean)} · max ${fmt(scores[scores.length - 1] ?? 0)}`
  )
  console.log(
    `≥ ${floor}: ${rejected.length}/${rows.length} rejected · wrong verdicts at this floor: ${wrong.length}`
  )
  for (const r of wrong) {
    console.log(
      `  ✗ ${r.id}  score=${fmt(r.score)}${r.containment ? ' (containment)' : ''}  ↳ "${r.line.slice(0, 90)}"`
    )
  }
}

function sweep(groups: Array<{ name: string; rows: Scored[] }>): void {
  console.log(
    '\n## Floor sweep — wrong verdicts per group (FP = novel rejected, FN = restatement kept)'
  )
  const floors = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7]
  console.log(['floor', ...groups.map(g => g.name)].join('\t'))
  for (const f of floors) {
    const cells = groups.map(g => {
      const fp = g.rows.filter(r => r.expect === 'KEEP' && r.score >= f).length
      const fn = g.rows.filter(r => r.expect === 'REJECT' && r.score < f).length
      return g.rows[0]?.expect === 'KEEP'
        ? `FP ${fp}/${g.rows.length}`
        : `FN ${fn}/${g.rows.length}`
    })
    console.log(
      [
        f.toFixed(2) + (f === CONSTITUTION_REDUNDANCY_FLOOR ? '*' : ''),
        ...cells,
      ].join('\t')
    )
  }
}

const floor = CONSTITUTION_REDUNDANCY_FLOOR
console.log(`# Constitution-redundancy floor review (LUM-778) — floor=${floor}`)
console.log(
  `EN constitution: ${constitutionLines(EN_CONSTITUTION).length} candidate lines (CLAUDE.md + AGENTS.md of this repo)`
)
console.log(
  `ZH constitution: ${constitutionLines(ZH_CONSTITUTION).length} candidate lines`
)

const g = [
  { name: 'EN-novel vs EN', rows: score(enNovel, EN_CONSTITUTION) },
  { name: 'EN-restate vs EN', rows: score(enRestate, EN_CONSTITUTION) },
  { name: 'ZH-novel vs EN', rows: score(zhNovel, EN_CONSTITUTION) },
  { name: 'ZH-restate vs EN', rows: score(zhRestate, EN_CONSTITUTION) },
  { name: 'ZH-novel vs ZH', rows: score(zhNovel, ZH_CONSTITUTION) },
  { name: 'ZH-restate vs ZH', rows: score(zhRestate, ZH_CONSTITUTION) },
]
for (const grp of g) report(grp.name, grp.rows, floor)
sweep(g)
