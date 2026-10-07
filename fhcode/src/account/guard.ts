/**
 * Account limits for FH Code.
 *
 * Every agent turn is billed to the user's FOTOhub wallet. Before each turn the
 * guard checks the account's limits and refuses early, with a top-up link, when
 * the turn could not be paid for. After each turn it records what was charged.
 *
 * Where the limits come from is pluggable (AccountProvider):
 *   - FotohubApiAccountProvider reads the public API: wallet balance and monthly
 *     cap from GET /v1/billing/balance, tier and rate limit from GET /v1/tiers/current.
 *   - HttpAccountProvider reads any endpoint that returns AccountLimits as JSON,
 *     for account-level limits served by fotohub.app.
 *   - FH Code (the host app) can pass its own provider through the library API.
 */

import type { FotohubClient } from "../api/client.js";
import type { Billing } from "../api/sse.js";

export const TOPUP_URL = "https://fotohub.app/console?tab=billing";

export interface AccountLimits {
  /** Spendable wallet balance in USD. */
  balanceUsd: number;
  /** Self-imposed monthly cap in USD, or null when none is set. */
  monthlyLimitUsd: number | null;
  /** Spend so far this calendar month in USD. */
  spentThisMonthUsd: number;
  /** Tier slug, e.g. "payg-standard". */
  tier?: string;
  /** Requests per minute the tier allows. */
  rpm?: number;
  /** Where these numbers came from, for display. */
  source: string;
}

export interface AccountProvider {
  getLimits(signal?: AbortSignal): Promise<AccountLimits>;
}

export class FotohubApiAccountProvider implements AccountProvider {
  constructor(private readonly client: FotohubClient) {}

  async getLimits(signal?: AbortSignal): Promise<AccountLimits> {
    const [balance, tier] = await Promise.all([
      this.client.getBalance(signal),
      // The tier only adds display detail; a failure here must not block a turn.
      this.client.getCurrentTier(signal).catch(() => undefined),
    ]);
    return {
      balanceUsd: balance.wallet?.balance_usd ?? 0,
      monthlyLimitUsd: balance.spend?.monthly_limit_usd ?? null,
      spentThisMonthUsd: balance.spend?.this_month_usd ?? 0,
      tier: tier?.tier,
      rpm: tier?.limits?.rpm,
      source: "FOTOhub API",
    };
  }
}

/** Reads AccountLimits as JSON from a URL, e.g. an account endpoint on fotohub.app. */
export class HttpAccountProvider implements AccountProvider {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getLimits(signal?: AbortSignal): Promise<AccountLimits> {
    const res = await this.fetchImpl(this.url, {
      signal,
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Account limits request to ${this.url} failed: HTTP ${res.status}`);
    const data = (await res.json()) as Partial<AccountLimits>;
    return {
      balanceUsd: Number(data.balanceUsd ?? 0),
      monthlyLimitUsd: data.monthlyLimitUsd ?? null,
      spentThisMonthUsd: Number(data.spentThisMonthUsd ?? 0),
      tier: data.tier,
      rpm: data.rpm,
      source: data.source ?? this.url,
    };
  }
}

export class AccountLimitError extends Error {
  readonly topupUrl: string;

  constructor(message: string, topupUrl = TOPUP_URL) {
    super(message);
    this.name = "AccountLimitError";
    this.topupUrl = topupUrl;
  }
}

export interface AccountGuardOptions {
  provider: AccountProvider;
  /** Hard cap for this session in USD; undefined means no session cap. */
  sessionBudgetUsd?: number;
  /** Refuse a turn when the wallet holds less than this, in USD. */
  minBalanceUsd?: number;
  /** How long fetched limits are reused, in ms. */
  cacheMs?: number;
}

export class AccountGuard {
  private readonly provider: AccountProvider;
  private readonly sessionBudgetUsd: number | undefined;
  private readonly minBalanceUsd: number;
  private readonly cacheMs: number;
  private cached: { at: number; limits: AccountLimits } | undefined;
  private spentUsd = 0;
  private turns = 0;
  // Spend recorded since the cached limits were fetched, so a cached balance is
  // not reused as if nothing had been spent since.
  private spentSinceFetchUsd = 0;

  constructor(options: AccountGuardOptions) {
    this.provider = options.provider;
    this.sessionBudgetUsd = options.sessionBudgetUsd;
    this.minBalanceUsd = options.minBalanceUsd ?? 0;
    this.cacheMs = options.cacheMs ?? 60_000;
  }

  get sessionSpentUsd(): number {
    return this.spentUsd;
  }

  get sessionTurns(): number {
    return this.turns;
  }

  async limits(signal?: AbortSignal, fresh = false): Promise<AccountLimits> {
    if (!fresh && this.cached && Date.now() - this.cached.at < this.cacheMs) return this.cached.limits;
    const limits = await this.provider.getLimits(signal);
    this.cached = { at: Date.now(), limits };
    this.spentSinceFetchUsd = 0;
    return limits;
  }

  /** Throws AccountLimitError when the next turn should not run. */
  async preflight(signal?: AbortSignal): Promise<void> {
    if (this.sessionBudgetUsd !== undefined && this.spentUsd >= this.sessionBudgetUsd) {
      throw new AccountLimitError(
        `Session budget reached: spent $${fmt(this.spentUsd)} of $${fmt(this.sessionBudgetUsd)}. ` +
          `Start a new session or raise --max-budget-usd.`,
      );
    }
    const limits = await this.limits(signal);
    const balance = limits.balanceUsd - this.spentSinceFetchUsd;
    if (balance <= this.minBalanceUsd) {
      throw new AccountLimitError(
        `Your FOTOhub wallet balance is $${fmt(Math.max(balance, 0))}. Top up to continue: ${TOPUP_URL}`,
      );
    }
    if (limits.monthlyLimitUsd !== null && limits.spentThisMonthUsd + this.spentSinceFetchUsd >= limits.monthlyLimitUsd) {
      throw new AccountLimitError(
        `Your monthly spending limit of $${fmt(limits.monthlyLimitUsd)} is reached. ` +
          `Raise it in the FOTOhub Console: ${TOPUP_URL}`,
      );
    }
  }

  /** Records what one completed turn cost. */
  record(billing: Billing | undefined): number {
    this.turns++;
    const charged = chargedUsd(billing);
    this.spentUsd += charged;
    this.spentSinceFetchUsd += charged;
    return charged;
  }

  /** Forgets cached limits, e.g. after the user tops up. */
  invalidate(): void {
    this.cached = undefined;
  }
}

/** USD that left the wallet for a turn: usd_charged, else the token cost. */
export function chargedUsd(billing: Billing | undefined): number {
  if (!billing) return 0;
  if (typeof billing.usd_charged === "number") return billing.usd_charged;
  const cost = billing.cost_breakdown?.cost_usd;
  return typeof cost === "number" ? cost : 0;
}

/** Dollars to cents, and small amounts to three significant digits, so $0.0073 does not show as $0.01. */
export function fmt(usd: number): string {
  if (usd === 0 || Math.abs(usd) >= 1) return usd.toFixed(2);
  const s = String(Number(usd.toPrecision(3)));
  return /\.\d$/.test(s) ? `${s}0` : s;
}
