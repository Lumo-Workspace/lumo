/**
 * LUM-805: run 历史里的证据条。
 *
 * 这个 feature 之前的失败方式很具体：证据上传成功、落库成功、页面上只出现一句
 * 「2 evidence items」。所以这里断言的不是「渲染没报错」，而是**证据本身在页面
 * 上出现了、并且指向那个文件**。
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'

// react-intl 在这套 jest 配置下是 ESM-only，仓库约定是 mock 掉它并回退到真的
// en.json（与 TestCaseCard.test.tsx 同一份 mock）。
jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: (
        { id, defaultMessage }: { id: string; defaultMessage?: string },
        values?: Record<string, string | number>
      ) => {
        const raw = messages[id] ?? defaultMessage ?? id
        if (!values) return raw
        return Object.entries(values).reduce(
          (acc, [k, v]) =>
            acc.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)),
          raw
        )
      },
    }),
  }
})

import { RunHistoryList } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RunHistoryList'

const SHOT_URL = 'https://blob.example.com/test-evidence/t/c/abc.png'
const SHOT2_URL = 'https://blob.example.com/test-evidence/t/c/ghi.png'
const LOG_URL = 'https://blob.example.com/test-evidence/t/c/def.log'

const run = (evidence: unknown) =>
  ({
    id: 'run-1',
    testCaseId: 'tc-1',
    taskId: 't-1',
    result: 'FAIL',
    environment: 'LOCAL',
    failedPhase: null,
    failedIndex: null,
    failedStepText: null,
    evidence,
    note: 'footer lost its disclosure line',
    pullRequestId: null,
    commitSha: null,
    commitDirty: null,
    actorMemberId: null,
    sourceSessionId: null,
    createdAt: new Date('2026-09-21'),
  }) as never

const screenshot = {
  type: 'file',
  url: SHOT_URL,
  filename: 'footer.png',
  contentType: 'image/png',
  size: 1234,
}

const logFile = {
  type: 'file',
  url: LOG_URL,
  filename: 'jest.log',
  contentType: 'text/plain',
  size: 99,
}

describe('run evidence is visible, not just counted', () => {
  it('renders image evidence as a thumbnail that opens a preview', () => {
    render(
      <RunHistoryList
        requiredEnvironment={null}
        runs={[run([screenshot])]}
        pullRequests={[]}
      />
    )

    const thumbnail = screen.getByAltText('footer.png')
    expect(thumbnail).toHaveAttribute('src', SHOT_URL)
    // 缩略图必须自己就是那个可点开的东西 —— 不是一段旁边挂着按钮的装饰。
    expect(thumbnail.closest('button')).toHaveAccessibleName(
      'Preview footer.png'
    )
  })

  it('opens the lightbox in place, with the original one click away', () => {
    render(
      <RunHistoryList
        requiredEnvironment={null}
        runs={[run([screenshot])]}
        pullRequests={[]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview footer.png' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByAltText('footer.png')).toHaveAttribute(
      'src',
      SHOT_URL
    )
    const original = within(dialog).getByRole('link', {
      name: /Open original/,
    })
    expect(original).toHaveAttribute('href', SHOT_URL)
    expect(original).toHaveAttribute('target', '_blank')
    expect(original).toHaveAttribute('rel', expect.stringContaining('noopener'))
    // 只有一张图时不出左右切换。
    expect(
      within(dialog).queryByRole('button', { name: 'Next' })
    ).not.toBeInTheDocument()
  })

  it('steps through every image of the run with arrows and buttons, skipping non-images', () => {
    const second = { ...screenshot, url: SHOT2_URL, filename: 'header.png' }
    render(
      <RunHistoryList
        requiredEnvironment={null}
        runs={[run([screenshot, logFile, second])]}
        pullRequests={[]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview header.png' }))
    let dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('2 / 2')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Next' })).toBeDisabled()

    fireEvent.keyDown(dialog, { key: 'ArrowLeft' })
    dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('1 / 2')).toBeInTheDocument()
    expect(within(dialog).getByAltText('footer.png')).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'Previous' })
    ).toBeDisabled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }))
    expect(
      within(screen.getByRole('dialog')).getByAltText('header.png')
    ).toBeInTheDocument()
  })

  it('renders a non-image file as a named link instead of a thumbnail', () => {
    render(
      <RunHistoryList
        requiredEnvironment={null}
        runs={[run([logFile])]}
        pullRequests={[]}
      />
    )

    expect(screen.getByRole('link', { name: 'jest.log' })).toHaveAttribute(
      'href',
      LOG_URL
    )
    expect(screen.queryByAltText('jest.log')).not.toBeInTheDocument()
  })

  it('renders a link entry by its label', () => {
    render(
      <RunHistoryList
        requiredEnvironment={null}
        runs={[
          run([
            {
              type: 'link',
              url: 'https://ci.example.com/run/7',
              label: 'CI run',
            },
          ]),
        ]}
        pullRequests={[]}
      />
    )

    expect(screen.getByRole('link', { name: 'CI run' })).toHaveAttribute(
      'href',
      'https://ci.example.com/run/7'
    )
  })

  it('no longer prints a bare count in place of the evidence', () => {
    render(
      <RunHistoryList
        requiredEnvironment={null}
        runs={[run([screenshot, logFile])]}
        pullRequests={[]}
      />
    )

    // 计数只作为列表的 aria-label 留给读屏，不再占据可见的一行。
    // （名字用正则：这套测试里 react-intl 是 mock 的，不做 ICU 复数展开。）
    expect(screen.queryByText(/evidence item/)).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: /evidence/ })).toBeInTheDocument()
    // 图片是预览按钮，日志是链接 —— 两条都可点。
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(
      screen.getByRole('button', { name: 'Preview footer.png' })
    ).toBeInTheDocument()
  })

  it('keeps the run row readable when the evidence payload is junk', () => {
    const rendered = render(
      <RunHistoryList
        requiredEnvironment={null}
        runs={[run(['nope', null, { type: 'wormhole' }])]}
        pullRequests={[]}
      />
    )

    expect(rendered.container).toBeInTheDocument()
    expect(
      screen.getByText('footer lost its disclosure line')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('list', { name: /evidence/ })
    ).not.toBeInTheDocument()
  })
})
