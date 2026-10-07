export type Wallet = { signedIn: boolean; balance: string; session: string } | null

declare module 'claude-code' {
  interface PluginState {
    'fh-code-ui': { isExpanded: boolean; wallet: Wallet; account: string | null }
  }
}
