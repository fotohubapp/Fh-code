import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} }
const BAND = { plugin: 'fh-code-ui', surface: 'terminal', component: 'AbovePrompt', props: PROPS } as const
const RUN = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

describe('register', () => {
  test('the full FOTOhub API panel shows at the start, with its actions', async $ => {
    const ui = await $.ui.mount(BAND)
    expect(await ui.find({ text: 'FH Code' })).toBeDefined()
    expect(await ui.find({ text: '/fotohub:design' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'compact' })).toBeDefined()
  })

  test('Compact keeps the header on screen; /fh brings the full panel back', async ($, on) => {
    on('env.get', () => ({ value: undefined }))
    const ui = await $.ui.mount(BAND)
    await ui.press({ key: 'compact' })
    expect(await ui.find({ text: 'FH Code' })).toBeDefined()
    expect(await ui.find({ text: '/fotohub:design' })).toBeUndefined()
    const { text } = await $.command.run({ command: 'fh', ...RUN })
    expect(text).toContain('FOTOhub API')
    expect(await ui.find({ text: '/fotohub:design' })).toBeDefined()
  })

  test('the header stays while a turn runs, compact', async $ => {
    const ui = await $.ui.mount({ ...BAND, props: { ...PROPS, isWorking: true } })
    expect(await ui.find({ text: 'FH Code' })).toBeDefined()
    expect(await ui.find({ text: '/fotohub:design' })).toBeUndefined()
  })

  test('outside FH Code, /login is left to the engine', async ($, on) => {
    on('env.get', () => ({ value: undefined }))
    on('command.run', () => ({ text: 'engine login' }))
    const { text } = await $.command.run({ command: 'login', ...RUN })
    expect(text).toBe('engine login')
  })

  test('with the hero at the top of the terminal, the band starts compact', async ($, on) => {
    on('env.get', (_$, e) => ({ value: e.name === 'FHCODE_HERO' ? 'top' : undefined }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount(BAND)
    expect(await ui.find({ text: 'FH Code' })).toBeDefined()
    expect(await ui.find({ text: '/fotohub:design' })).toBeUndefined()
  })

  test('/budget sets the session budget through the FH Code gateway', async ($, on) => {
    const env: Record<string, string> = { FHCODE_GATEWAY_URL: 'http://127.0.0.1:9', FHCODE_GATEWAY_TOKEN: 't' }
    on('env.get', (_$, e) => ({ value: env[e.name] }))
    const sent: unknown[] = []
    on('http.fetch', (_$, e) => {
      if (e.url.endsWith('/fh/budget')) sent.push(JSON.parse(String(e.init?.body)))
      const status = { signedIn: true, balanceUsd: 12, sessionUsd: 0.5, budgetUsd: 5, assets: 2 }
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(status) } }
    })
    const set = await $.command.run({ command: 'budget', ...RUN, args: '5' })
    expect(set.text).toContain('Session budget: $5.00')
    expect(sent).toEqual([{ usd: 5 }])
    const bad = await $.command.run({ command: 'budget', ...RUN, args: 'lots' })
    expect(bad.text).toContain('Usage: /budget')
    const ui = await $.ui.mount({ ...BAND, props: { ...PROPS, isWorking: true } })
    expect(await ui.find({ text: 'wallet $12.00 · session $0.50 of $5.00 · 2 assets' })).toBeDefined()
  })
})
