import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} }
const BAND = { plugin: 'fh-code-ui', surface: 'terminal', component: 'AbovePrompt', props: PROPS } as const

describe('register', () => {
  test('the FOTOhub API hero shows above the prompt with its actions', async $ => {
    const ui = await $.ui.mount(BAND)
    expect(await ui.find({ text: 'FH Code' })).toBeDefined()
    expect(await ui.find({ text: '/fotohub:generate' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'hide' })).toBeDefined()
  })

  test('Hide removes it and /fh brings it back', async ($, on) => {
    // Beneath the plugins the engine draws nothing in the band of its own.
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })
    on('env.get', () => ({ value: undefined }))
    const ui = await $.ui.mount(BAND)
    await ui.press({ key: 'hide' })
    expect(await ui.find({ text: 'FH Code' })).toBeUndefined()
    const { text } = await $.command.run({ command: 'fh', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    expect(text).toContain('FOTOhub API')
    expect(await ui.find({ text: 'FH Code' })).toBeDefined()
  })

  test('it steps aside while a turn runs', async ($, on) => {
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })
    const ui = await $.ui.mount({ ...BAND, props: { ...PROPS, isWorking: true } })
    expect(await ui.find({ text: 'FH Code' })).toBeUndefined()
  })
})
