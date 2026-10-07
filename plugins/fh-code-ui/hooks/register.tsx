import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Wallet } from '../types'
import { gradient, wordmark } from './wordmark'

const isHeroShown = atom({ plugin: 'fh-code-ui', key: 'isHeroShown' } as const, true)
const wallet = atom({ plugin: 'fh-code-ui', key: 'wallet' } as const, null)

const ACTIONS: [string, string][] = [
  ['/fotohub:generate', 'image, video, audio or 3D, priced before it runs'],
  ['/fotohub:integrate', 'add the FOTOhub API to this project'],
  ['/fotohub:wallet', 'balance, limits and top-ups'],
  ['fhcode hub', 'background agents, in the browser'],
]

async function refreshWallet($: EngineInterface): Promise<void> {
  try {
    const url = await $.env.get('FHCODE_GATEWAY_URL')
    const token = await $.env.get('FHCODE_GATEWAY_TOKEN')
    if (!url || !token) return
    const res = await $.http.fetch(`${url}/fh/status`, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) return
    const s = JSON.parse(res.text) as { balanceUsd: number | null; sessionUsd: number }
    const money = (v: number) => (v >= 1 || v === 0 ? v.toFixed(2) : String(Number(v.toPrecision(3))))
    const next: Wallet = { balance: s.balanceUsd === null ? '?' : money(s.balanceUsd), session: money(s.sessionUsd) }
    await update($, wallet, () => next)
  } catch {
    // Outside FH Code (no gateway), or the gateway is gone: the hero shows without the wallet.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (e.isInteractive) {
      await $.command.register({ name: 'fh', description: 'Show the FH Code · FOTOhub API panel again' })
      void refreshWallet($)
    }
    return started
  })

  on('command.run', { command: 'fh' }, async $ => {
    await update($, isHeroShown, () => true)
    void refreshWallet($)
    return { text: 'FH Code · FOTOhub API panel shown above the prompt.' }
  })

  // The hero steps aside once the work starts.
  on('prompt.submit', async ($, e, next) => {
    await update($, isHeroShown, () => false).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    void refreshWallet($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.isWorking || !(await read($, isHeroShown))) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const w = await read($, wallet)
    const rows = wordmark('FOTOhub API')
    const compact = (e.props.maxRows ?? 12) < 9

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={gradient(0.15)} paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="column">
            {rows.map((row, r) => (
              <Text key={`wm${r}`}>
                {row.map(([ch, color], i) => (
                  <Text key={`c${r}-${i}`} color={color} bold>
                    {ch}
                  </Text>
                ))}
              </Text>
            ))}
          </Box>
          <Box flexDirection="column" alignItems="flex-end">
            <Text color={gradient(0.5)} bold>
              FH Code
            </Text>
            <Text dimColor>{w ? `wallet $${w.balance} · session $${w.session}` : 'wallet …'}</Text>
          </Box>
        </Box>
        <Text>
          <Text color={gradient(0)}>━━━━━━━━━━</Text>
          <Text color={gradient(0.5)}>━━━━━━━━━━</Text>
          <Text color={gradient(1)}>━━━━━━━━━━</Text>
          <Text dimColor> AI images · video · audio · 3D · code, one API</Text>
        </Text>
        {!compact &&
          ACTIONS.map(([cmd, what]) => (
            <Text key={cmd}>
              <Text color={gradient(0.35)}>› </Text>
              <Text bold>{cmd.padEnd(20)}</Text>
              <Text dimColor>{what}</Text>
            </Text>
          ))}
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor>docs.fotohub.app · type a task to start</Text>
          <Button key="hide" label="Hide" onPress={() => update($, isHeroShown, () => false)} />
        </Box>
      </Box>
    )
  })
}
