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
})
