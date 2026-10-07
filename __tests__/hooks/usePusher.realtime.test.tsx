const ctor = jest.fn()
const subscribe = jest.fn()
const unsubscribe = jest.fn()
const bind = jest.fn()
const unbind = jest.fn()
jest.mock('pusher-js', () =>
  jest.fn().mockImplementation((key: string, opts: unknown) => {
    ctor(key, opts)
    subscribe.mockReturnValue({ bind, unbind })
    return { subscribe, unsubscribe }
  })
)

type HookModule =
  typeof import('@/app/workspace/[workspaceUrl]/hooks/usePusher') & {
    renderHook: typeof import('@testing-library/react').renderHook
  }
type ClientModule = typeof import('@/lib/integrations/pusher/client')

const ENV_KEYS = [
  'NEXT_PUBLIC_PUSHER_KEY',
  'NEXT_PUBLIC_PUSHER_CLUSTER',
  'NEXT_PUBLIC_PUSHER_HOST',
  'NEXT_PUBLIC_PUSHER_PORT',
  'NEXT_PUBLIC_PUSHER_USE_TLS',
]

function loadWith(env: Record<string, string>): HookModule {
  for (const k of ENV_KEYS) delete process.env[k]
  Object.assign(process.env, env)
  let mod: HookModule | undefined
  jest.isolateModules(() => {
    // React + testing-library are loaded inside the same isolated registry
    // so the hook and the renderer share one React instance.
    mod = {
      ...require('@/app/workspace/[workspaceUrl]/hooks/usePusher'),
      renderHook: require('@testing-library/react/pure').renderHook,
    }
  })
  return mod!
}

beforeEach(() => {
  ;[ctor, subscribe, unsubscribe, bind, unbind].forEach(f => f.mockReset())
})

describe('usePusherEvent', () => {
  it('unconfigured: never constructs pusher-js or subscribes', () => {
    const { usePusherEvent, renderHook } = loadWith({})
    const { unmount } = renderHook(() =>
      usePusherEvent('task-1', 'task-update', jest.fn())
    )
    unmount()
    expect(ctor).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('custom host: connects to wsHost and subscribes/cleans up', () => {
    const { usePusherEvent, renderHook } = loadWith({
      NEXT_PUBLIC_PUSHER_KEY: 'k',
      NEXT_PUBLIC_PUSHER_HOST: 'localhost',
      NEXT_PUBLIC_PUSHER_PORT: '6001',
      NEXT_PUBLIC_PUSHER_USE_TLS: 'false',
    })
    const { unmount } = renderHook(() =>
      usePusherEvent('task-1', 'task-update', jest.fn())
    )
    expect(ctor).toHaveBeenCalledWith(
      'k',
      expect.objectContaining({
        wsHost: 'localhost',
        wsPort: 6001,
        wssPort: 6001,
        forceTLS: false,
        enabledTransports: ['ws', 'wss'],
      })
    )
    expect(subscribe).toHaveBeenCalledWith('task-1')
    expect(bind).toHaveBeenCalledWith('task-update', expect.any(Function))
    unmount()
    expect(unsubscribe).toHaveBeenCalledWith('task-1')
  })
})

describe('toPusherJsOptions', () => {
  it('cloud maps to cluster + forceTLS only', () => {
    let client: ClientModule | undefined
    jest.isolateModules(() => {
      client = require('@/lib/integrations/pusher/client')
    })
    expect(
      client!.toPusherJsOptions({
        mode: 'cloud',
        key: 'k',
        cluster: 'us2',
        forceTLS: true,
      })
    ).toEqual({ cluster: 'us2', forceTLS: true })
  })
})

export {}
