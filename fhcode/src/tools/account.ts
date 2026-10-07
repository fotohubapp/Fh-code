import { fmt, TOPUP_URL } from "../account/guard.js";
import { num, str, ToolInputError, type Tool } from "./types.js";

export const walletTool: Tool = {
  kind: "read",
  definition: {
    name: "fotohub_wallet",
    description:
      "Show the user's FOTOhub account: prepaid USD wallet balance, spend this month, monthly spending limit, tier and rate limit, " +
      "and what this FH Code session has spent so far. Free.",
    input_schema: { type: "object", properties: {} },
  },
  describe: () => "check FOTOhub wallet",
  async run(_input, ctx) {
    const limits = await ctx.guard.limits(ctx.signal, true);
    const lines = [
      `Wallet balance: $${fmt(limits.balanceUsd)}`,
      `Spent this month: $${fmt(limits.spentThisMonthUsd)}`,
      `Monthly limit: ${limits.monthlyLimitUsd === null ? "none set" : `$${fmt(limits.monthlyLimitUsd)}`}`,
    ];
    if (limits.tier) lines.push(`Tier: ${limits.tier}${limits.rpm ? ` (${limits.rpm} requests/min)` : ""}`);
    lines.push(`This session: $${fmt(ctx.guard.sessionSpentUsd)} over ${ctx.guard.sessionTurns} turns`);
    lines.push(`Source: ${limits.source}`);
    lines.push(`Top up or change limits: ${TOPUP_URL}`);
    return lines.join("\n");
  },
};

export const packagesTool: Tool = {
  kind: "read",
  definition: {
    name: "fotohub_packages",
    description:
      "List FOTOhub wallet top-up packages from the Console, with the price paid, the volume bonus and the amount credited. Free.",
    input_schema: { type: "object", properties: {} },
  },
  describe: () => "list FOTOhub top-up packages",
  async run(_input, ctx) {
    const list = await ctx.client.getTopupPackages(ctx.signal);
    const rows = list.packages.map(
      (p) =>
        `- ${p.slug}: pay $${fmt(p.amount_usd)} → $${fmt(p.total_usd)} in the wallet` +
        (p.bonus_usd ? ` (+$${fmt(p.bonus_usd)} bonus)` : "") +
        (p.popular ? " [popular]" : ""),
    );
    if (list.min_usd !== undefined && list.max_usd !== undefined) {
      rows.push(`Custom amounts: $${fmt(list.min_usd)} to $${fmt(list.max_usd)}.`);
    }
    return rows.length ? rows.join("\n") : "No packages returned.";
  },
};

export const topupTool: Tool = {
  kind: "paid",
  definition: {
    name: "fotohub_topup",
    description:
      "Create a Stripe checkout link to top up the user's FOTOhub wallet by amount_usd. Nothing is charged until the user " +
      "opens the link and pays. Only call this when the user asks to top up.",
    input_schema: {
      type: "object",
      properties: {
        amount_usd: { type: "number", description: "Whole cents, at least 10." },
        pay_currency: { type: "string", enum: ["usd", "pln"] },
      },
      required: ["amount_usd"],
    },
  },
  describe: (input) => `create a $${String(input.amount_usd)} top-up checkout link`,
  async run(input, ctx) {
    const amount = num(input, "amount_usd");
    if (amount === undefined || amount < 10) throw new ToolInputError("amount_usd must be at least 10.");
    const currency = str(input, "pay_currency", false);
    if (currency && currency !== "usd" && currency !== "pln") throw new ToolInputError('pay_currency must be "usd" or "pln".');
    const checkout = await ctx.client.createTopupCheckout(amount, (currency || undefined) as "usd" | "pln" | undefined, ctx.signal);
    ctx.guard.invalidate();
    return (
      `Checkout link (pay $${fmt(checkout.amount_usd)}, wallet gets $${fmt(checkout.total_credited_usd)}): ${checkout.checkout_url}\n` +
      "Nothing has been charged yet; the wallet is credited after payment."
    );
  },
};
