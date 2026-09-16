/**
 * LUM-758 — 在真实的 hunt 沙箱镜像里复现 #1015 闸门的三个洞。
 *
 * 为什么必须在镜像里跑：本机 macOS 的 sort 是 Apple 2.3，镜像里是
 * uutils coreutils 0.8.0（Rust 重写版），两者对长选项缩写的处理不同；
 * 从 GNU 文档推结论会推错对象。
 *
 * 手动运行（会起一台 VM，需要本机已 vercel 登录）：
 *   npx tsx scripts/analysis/lum758-gate-probe/probe.ts
 *
 * 2026-09-16 的实测结果（修复前的闸门全部放行这三条）：
 *   A: sort --compress-program=/tmp/cp.sh  -> /tmp/EXECUTED 被创建（任意执行）
 *   B: sort --comp=/tmp/cp.sh              -> 同上（前缀缩写，judge 未报）
 *   C: sort --o=/tmp/p1                    -> 文件被写出（前缀缩写，judge 未报）
 *   D: git grep -O/bin/echo needle         -> /bin/echo 被执行（附着取值）
 *   E: git -cfoo.bar=baz config            -> git 自己就拒（judge 报的病因是错的）
 *   F: git grep -nO/bin/echo needle        -> /bin/echo 被执行（短选项成簇；
 *                                             这一条是 PR 1023 的扫描在第一版
 *                                             修复上报出来的，第一版只认附着）
 *   G: git ls-files -o                     -> 列出未跟踪文件，只读；小写 -o
 *                                             不能被 -O 的簇判据连坐
 *
 * 探针只写 /tmp，不碰仓库。
 */
import { Sandbox } from '@vercel/sandbox'

const MAKE_CP = [
  'printf "#!/bin/sh\ntouch /tmp/EXECUTED\nexec cat\n" > /tmp/cp.sh',
  'chmod +x /tmp/cp.sh',
].join('; ')
const BIG = 'yes abcdefghij | head -400000'
const MAKE_REPO =
  'rm -rf /tmp/g; mkdir -p /tmp/g && cd /tmp/g && git init -q . && echo needle > f.txt && git add -A && git -c user.email=a@b -c user.name=a commit -qm x'

const PROBES: ReadonlyArray<readonly [string, string]> = [
  ['环境', 'sort --version | head -1; git --version'],
  [
    'A  sort --compress-program 执行任意程序',
    `${MAKE_CP}; rm -f /tmp/EXECUTED; ${BIG} | sort -S 1K --compress-program=/tmp/cp.sh >/dev/null 2>&1; test -e /tmp/EXECUTED && echo EXECUTED || echo "not executed"`,
  ],
  [
    'B  前缀缩写 --comp= 同样执行',
    `rm -f /tmp/EXECUTED; ${BIG} | sort -S 1K --comp=/tmp/cp.sh >/dev/null 2>&1; test -e /tmp/EXECUTED && echo EXECUTED || echo "not executed"`,
  ],
  [
    'C  前缀缩写 --o= / --outp= 绕过写文件闸',
    'rm -f /tmp/p1 /tmp/p2; printf "b\na\n" | sort --o=/tmp/p1; printf "b\na\n" | sort --outp=/tmp/p2; echo "--o=    -> $(tr "\n" " " < /tmp/p1)"; echo "--outp= -> $(tr "\n" " " < /tmp/p2)"',
  ],
  [
    'D  git 短选项附着取值执行程序',
    `${MAKE_REPO} && git grep -O/bin/echo needle 2>&1 | head -3`,
  ],
  [
    'E  git 全局附着 -c（judge 报的病因，实际不成立）',
    'git -cfoo.bar=baz config --get foo.bar 2>&1 | head -1',
  ],
  [
    'F  git 短选项簇里藏 -O（PR 1023 的扫描在第一版修复上报的）',
    `${MAKE_REPO} && echo "-nO -> $(git grep -nO/bin/echo needle 2>&1 | head -1)" && echo "-iO -> $(git grep -iO/bin/echo needle 2>&1 | head -1)"`,
  ],
  [
    'G  小写 -o 是 git ls-files --others，只读，不能被簇判据连坐',
    `${MAKE_REPO} && echo untracked > u.txt && git ls-files -o 2>&1 | head -3`,
  ],
]

async function main() {
  const sandbox = await Sandbox.create({
    timeout: 5 * 60 * 1000,
    image: 'vercel/sandbox/universal',
  })
  try {
    for (const [name, cmd] of PROBES) {
      const r = await sandbox.runCommand({ cmd: 'sh', args: ['-c', cmd] })
      const out = ((await r.stdout()) + (await r.stderr())).trim()
      console.log(
        `\n### ${name}\n  exit=${r.exitCode}\n${out
          .split('\n')
          .map(l => '  | ' + l)
          .join('\n')}`
      )
    }
  } finally {
    await sandbox.stop()
  }
}

main()
