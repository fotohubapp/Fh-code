import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Wallet } from '../types'
import { gradient, wordmark } from './wordmark'

// The FOTOhub API header is always on screen above the prompt: the full panel
// until the first prompt (and again with /fh), a compact header after that.
const isExpanded = atom({ plugin: 'fh-code-ui', key: 'isExpanded' } as const, true)
const wallet = atom({ plugin: 'fh-code-ui', key: 'wallet' } as const, null)
const account = atom({ plugin: 'fh-code-ui', key: 'account' } as const, null)

const ACTIONS: [string, string][] = [
  ['/fotohub:design', 'design mode: a stunning site with FOTOhub-generated imagery'],
  ['/fotohub:generate', 'image, video, audio or 3D, priced before it runs'],
  ['/fotohub:integrate', 'add the FOTOhub API to this project'],
  ['/login · /logout', 'your FOTOhub account'],
]

const money = (v: number) => (v >= 1 || v === 0 ? v.toFixed(2) : String(Number(v.toPrecision(3))))

async function refreshWallet($: EngineInterface): Promise<void> {
  try {
    const url = await $.env.get('FHCODE_GATEWAY_URL')
    const token = await $.env.get('FHCODE_GATEWAY_TOKEN')
    if (!url || !token) return
    const res = await $.http.fetch(`${url}/fh/status`, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) return
    const s = JSON.parse(res.text) as { signedIn?: boolean; balanceUsd: number | null; sessionUsd: number }
    const next: Wallet = {
      signedIn: s.signedIn !== false,
      balance: s.balanceUsd === null ? '?' : money(s.balanceUsd),
      session: money(s.sessionUsd),
    }
    await update($, wallet, () => next)
  } catch {
    // Outside FH Code (no gateway), or the gateway is gone: the header shows without the wallet.
  }
}

/** Runs FH Code itself (fhcode login / logout), relaying what it prints. */
async function runFhcode($: EngineInterface, args: string[]): Promise<{ code: number | null; output: string } | null> {
  const node = await $.env.get('FHCODE_NODE')
  const bin = await $.env.get('FHCODE_BIN')
  if (!node || !bin) return null
  let output = ''
  const run = $.process.spawn({ argv: [node, bin, ...args] })
  for await (const piece of run) {
    output += piece.text
    const url = /https:\/\/\S+cli-auth\S*/.exec(piece.text)?.[0]
    if (url) $.ui.toast(`Sign in to FOTOhub in your browser. If it did not open: ${url}`)
  }
  const { code } = await run.result
  return { code, output: output.trim() }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (e.isInteractive) {
      await $.command.register({ name: 'fh', description: 'Show the full FH Code · FOTOhub API panel' })
      void refreshWallet($)
    }
    return started
  })

  on('command.run', { command: 'fh' }, async $ => {
    await update($, isExpanded, open => !open)
    void refreshWallet($)
    return { text: 'FH Code · FOTOhub API panel toggled.' }
  })

  // /login and /logout are the FOTOhub account's in FH Code.
  on('command.describe', { command: 'login' }, async ($, e, next) => {
    const d = await next(e)
    return (await $.env.get('FHCODE_BIN')) ? { ...d, description: 'Sign in with your FOTOhub account' } : d
  })
  on('command.describe', { command: 'logout' }, async ($, e, next) => {
    const d = await next(e)
    return (await $.env.get('FHCODE_BIN')) ? { ...d, description: 'Sign out from your FOTOhub account' } : d
  })

  on('command.run', { command: 'login' }, async ($, e, next) => {
    if (!(await $.env.get('FHCODE_BIN'))) return next(e)
    $.ui.toast('Opening fotohub.app to sign in…')
    const ran = await runFhcode($, ['login'])
    if (!ran) return next(e)
    const signedIn = /Signed in to FOTOhub[^\n]*/.exec(ran.output)?.[0]
    await update($, account, () => (signedIn ? signedIn.replace(/^Signed in to FOTOhub( as )?/, '').replace(/\. Wallet.*$/, '') || 'FOTOhub' : null))
    await refreshWallet($)
    return {
      text:
        ran.code === 0
          ? `${signedIn ?? 'Signed in to FOTOhub.'}\nThe session now runs on this account. Run /mcp and reconnect "fotohub" to use its FOTOhub tools.`
          : `FOTOhub sign-in failed.\n${ran.output.split('\n').slice(-3).join('\n')}`,
    }
  })

  on('command.run', { command: 'logout' }, async ($, e, next) => {
    const ran = await runFhcode($, ['logout'])
    if (!ran) return next(e)
    await update($, account, () => null)
    await refreshWallet($)
    return { text: `${ran.output || 'Signed out of FOTOhub.'}\nUse /login to sign in again.` }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, isExpanded, () => false).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    void refreshWallet($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const w = await read($, wallet)
    const who = await read($, account)
    const expanded = (await read($, isExpanded)) && !e.props.isWorking && e.props.maxRows >= 9
    const rows = wordmark('FOTOhub API')
    const status = !w
      ? 'wallet …'
      : w.signedIn
        ? `wallet $${w.balance} · session $${w.session}`
        : 'not signed in · /login'

    const header = (
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
          <Text>
            <Text color={gradient(0.5)} bold>
              FH Code
            </Text>
            {who ? <Text dimColor> · {who}</Text> : null}
          </Text>
          <Text color={w && !w.signedIn ? 'warning' : undefined} dimColor={!w || w.signedIn}>
            {status}
          </Text>
        </Box>
      </Box>
    )

    if (!expanded) {
      return (
        <Box flexDirection="column" paddingX={1}>
          {header}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={gradient(0.15)} paddingX={1}>
        {header}
        <Text>
          <Text color={gradient(0)}>━━━━━━━━━━</Text>
          <Text color={gradient(0.5)}>━━━━━━━━━━</Text>
          <Text color={gradient(1)}>━━━━━━━━━━</Text>
          <Text dimColor> AI images · video · audio · 3D · code, one API</Text>
        </Text>
        {ACTIONS.map(([cmd, what]) => (
          <Text key={cmd}>
            <Text color={gradient(0.35)}>› </Text>
            <Text bold>{cmd.padEnd(20)}</Text>
            <Text dimColor>{what}</Text>
          </Text>
        ))}
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor>docs.fotohub.app · type a task to start · /fh toggles this panel</Text>
          <Button key="compact" label="Compact" onPress={() => update($, isExpanded, () => false)} />
        </Box>
      </Box>
    )
  })
}
