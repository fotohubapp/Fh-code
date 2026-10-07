export type Wallet = { balance: string; session: string } | null

declare module 'claude-code' {
  interface PluginState {
    'fh-code-ui': { isHeroShown: boolean; wallet: Wallet }
  }
}
