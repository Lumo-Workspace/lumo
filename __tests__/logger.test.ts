import { logger } from '@/lib/logger'

describe('logger', () => {
  const ORIGINAL_ENV = process.env
  let spies: Record<'debug' | 'info' | 'warn' | 'error', jest.SpyInstance>

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    delete process.env.LOG_LEVEL
    spies = {
      debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
      info: jest.spyOn(console, 'info').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
    }
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    jest.restoreAllMocks()
  })

  it('emits every level when LOG_LEVEL=debug', () => {
    process.env.LOG_LEVEL = 'debug'

    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')

    expect(spies.debug).toHaveBeenCalledTimes(1)
    expect(spies.info).toHaveBeenCalledTimes(1)
    expect(spies.warn).toHaveBeenCalledTimes(1)
    expect(spies.error).toHaveBeenCalledTimes(1)
  })

  it('suppresses below-threshold levels when LOG_LEVEL=warn', () => {
    process.env.LOG_LEVEL = 'warn'

    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')

    expect(spies.debug).not.toHaveBeenCalled()
    expect(spies.info).not.toHaveBeenCalled()
    expect(spies.warn).toHaveBeenCalledTimes(1)
    expect(spies.error).toHaveBeenCalledTimes(1)
  })

  it('defaults to info threshold in production (debug suppressed)', () => {
    ;(process.env as { NODE_ENV?: string }).NODE_ENV = 'production'

    logger.debug('d')
    logger.info('i')
    logger.warn('w')

    expect(spies.debug).not.toHaveBeenCalled()
    expect(spies.info).toHaveBeenCalledTimes(1)
    expect(spies.warn).toHaveBeenCalledTimes(1)
  })

  it('defaults to debug threshold outside production', () => {
    ;(process.env as { NODE_ENV?: string }).NODE_ENV = 'development'

    logger.debug('d')

    expect(spies.debug).toHaveBeenCalledTimes(1)
  })

  it('forwards all args to the underlying console method', () => {
    process.env.LOG_LEVEL = 'debug'
    const payload = { added: 1 }

    logger.info('[memory.layer2] applied project=p', payload)

    expect(spies.info).toHaveBeenCalledWith(
      '[memory.layer2] applied project=p',
      payload
    )
  })

  it('treats an unrecognised LOG_LEVEL as unset (falls back to env default)', () => {
    ;(process.env as { NODE_ENV?: string }).NODE_ENV = 'production'
    process.env.LOG_LEVEL = 'nonsense'

    logger.debug('d')
    logger.info('i')

    expect(spies.debug).not.toHaveBeenCalled()
    expect(spies.info).toHaveBeenCalledTimes(1)
  })
})
