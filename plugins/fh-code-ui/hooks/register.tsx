import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Wallet } from '../types'
import { gradient, wordmark } from './wordmark'

// The FOTOhub API header is always on screen above the prompt: the full panel
// until the first prompt (and again with /fh), a compact header after that.
// When FH Code drew its hero at the top of the terminal (FHCODE_HERO=top),
// the band starts compact.
const isExpanded = atom({ plugin: 'fh-code-ui', key: 'isExpanded' } as const, true)
const wallet = atom({ plugin: 'fh-code-ui', key: 'wallet' } as const, null)
const account = atom({ plugin: 'fh-code-ui', key: 'account' } as const, null)
const warnedLow = atom({ plugin: 'fh-code-ui', key: 'warnedLow' } as const, false)

const ACTIONS: [string, string][] = [
  ['/fotohub:design', 'design mode: a stunning site with FOTOhub-generated imagery'],
  ['/fotohub:generate', 'image, video, audio or 3D, priced before it runs'],
  ['/fotohub:ask', 'Gemini, GPT, Nova: a second opinion, priced'],
  ['/fotohub:integrate', 'add the FOTOhub API to this project'],
  ['/budget <usd>', "cap this session's spend · /budget off"],
  ['/login · /logout', 'your FOTOhub account'],
]

// As FH Code prints dollars: cents, and small amounts to three significant digits ($0.0073).
const money = (v: number) => {
  if (v >= 1 || v === 0) return v.toFixed(2)
  const s = String(Number(v.toPrecision(3)))
  return /\.\d$/.test(s) ? `${s}0` : s
}

type Status = {
  signedIn?: boolean
  balanceUsd: number | null
  sessionUsd: number
  budgetUsd?: number | null
  assets?: number
  lowBalance?: boolean
}

function toWallet(s: Status): Wallet {
  return {
    signedIn: s.signedIn !== false,
    balance: s.balanceUsd === null ? '?' : money(s.balanceUsd),
    session: money(s.sessionUsd),
    budget: s.budgetUsd ? money(s.budgetUsd) : null,
    assets: s.assets ?? 0,
    low: s.lowBalance === true,
  }
}

/** Calls the FH Code gateway; null outside FH Code. */
async function gateway($: EngineInterface, path: string, body?: unknown): Promise<{ ok: boolean; status: number; text: string } | null> {
  const url = await $.env.get('FHCODE_GATEWAY_URL')
  const token = await $.env.get('FHCODE_GATEWAY_TOKEN')
  if (!url || !token) return null
  return $.http.fetch(`${url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function refreshWallet($: EngineInterface): Promise<void> {
  try {
    const res = await gateway($, '/fh/status')
    if (!res?.ok) return
    const s = JSON.parse(res.text) as Status
    await update($, wallet, () => toWallet(s))
    if (s.lowBalance && !(await read($, warnedLow))) {
      await update($, warnedLow, () => true)
      $.ui.toast(`FOTOhub wallet is low: $${money(s.balanceUsd ?? 0)}. Top up at fotohub.app/console?tab=billing`)
    }
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
      await $.command.register({ name: 'budget', description: "Cap this session's FOTOhub spend: /budget 5 · /budget off" })
      if ((await $.env.get('FHCODE_HERO')) === 'top') await update($, isExpanded, () => false)
      void refreshWallet($)
    }
    return started
  })

  on('command.run', { command: 'fh' }, async $ => {
    await update($, isExpanded, open => !open)
    void refreshWallet($)
    return { text: 'FH Code · FOTOhub API panel toggled.' }
  })

  on('command.run', { command: 'budget' }, async ($, e) => {
    const arg = e.args.trim().replace(/^\$/, '')
    const status = async () => {
      const res = await gateway($, '/fh/status')
      return res?.ok ? (JSON.parse(res.text) as Status) : null
    }
    if (!arg) {
      const s = await status()
      if (!s) return { text: '/budget works in FH Code sessions.' }
      return {
        text: s.budgetUsd
          ? `Session budget: $${money(s.sessionUsd)} of $${money(s.budgetUsd)} spent. /budget <usd> changes it, /budget off removes it.`
          : `No session budget; $${money(s.sessionUsd)} spent so far. /budget <usd> sets one.`,
      }
    }
    const off = /^(off|none|clear|0)$/i.test(arg)
    const usd = Number(arg.replace(',', '.'))
    if (!off && !(usd > 0)) return { text: 'Usage: /budget 5 (USD for this session) · /budget off' }
    const res = await gateway($, '/fh/budget', { usd: off ? null : usd })
    if (!res) return { text: '/budget works in FH Code sessions.' }
    if (!res.ok) return { text: `Could not set the budget: ${res.text}` }
    const s = JSON.parse(res.text) as Status
    await update($, wallet, () => toWallet(s))
    return {
      text: off
        ? 'Session budget removed.'
        : `Session budget: $${money(usd)}. FH Code stops before a turn once $${money(usd)} is spent (now $${money(s.sessionUsd)}, generations included).`,
    }
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
        ? [
            `wallet $${w.balance}${w.low ? ' low' : ''}`,
            `session $${w.session}${w.budget ? ` of $${w.budget}` : ''}`,
            ...(w.assets ? [`${w.assets} asset${w.assets === 1 ? '' : 's'}`] : []),
          ].join(' · ')
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
          <Text color={w && (!w.signedIn || w.low) ? 'warning' : undefined} dimColor={!w || (w.signedIn && !w.low)}>
            {status}
          </Text>
        </Box>
      </Box>
    )

    if (!expanded) {
      // One line under the transcript: the hero itself is at the top of the terminal (or /fh).
      const name = [...'FOTOhub API']
      return (
        <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
          <Text>
            {name.map((ch, i) => (
              <Text key={`n${i}`} color={gradient(i / (name.length - 1))} bold>
                {ch}
              </Text>
            ))}
            <Text dimColor> · </Text>
            <Text color={gradient(0.5)} bold>
              FH Code
            </Text>
            {who ? <Text dimColor> · {who}</Text> : null}
          </Text>
          <Text color={w && (!w.signedIn || w.low) ? 'warning' : undefined} dimColor={!w || (w.signedIn && !w.low)}>
            {status}
          </Text>
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
