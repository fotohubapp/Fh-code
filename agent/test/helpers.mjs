// A stand-in for apis.fotohub.app: serves the wallet, tier and top-up endpoints
// and replays scripted agent turns on /v1/ai/agent/stream.

import http from "node:http";

export async function startMockApi({ turns = [], balance = 10, monthlyLimit = null, spent = 0 } = {}) {
  const requests = [];
  const queue = [...turns];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const json = body ? JSON.parse(body) : undefined;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: json });

    if (req.headers.authorization !== "Bearer fh_live_test_key") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ detail: "Invalid API key" }));
      return;
    }
    if (req.url === "/v1/billing/balance") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          wallet: { balance_usd: balance, pending_usd: 0, total_topped_up_usd: 50, currency: "USD" },
          spend: { this_month_usd: spent, monthly_limit_usd: monthlyLimit, currency: "USD" },
          billing_model: "prepaid_wallet_usd",
        }),
      );
      return;
    }
    if (req.url === "/v1/tiers/current") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ tier: "payg-standard", name: "PAYG Standard", limits: { rpm: 120 } }));
      return;
    }
    if (req.url === "/v1/billing/topup/packages") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          packages: [
            { slug: "topup-50", name: "$15", amount_usd: 15, bonus_usd: 0, total_usd: 15 },
            { slug: "scale-1000", name: "$1,000", amount_usd: 1000, bonus_usd: 100, total_usd: 1100, popular: true },
          ],
          min_usd: 10,
          max_usd: 15000,
        }),
      );
      return;
    }
    if (req.url === "/v1/ai/agent/stream") {
      const turn = queue.shift();
      if (!turn) {
        res.writeHead(500);
        res.end("no scripted turn left");
        return;
      }
      if (turn.status) {
        res.writeHead(turn.status, { "content-type": "application/json" });
        res.end(JSON.stringify(turn.body));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      // Split frames across writes to exercise buffering.
      const payload = turn.frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n";
      for (let i = 0; i < payload.length; i += 17) res.write(payload.slice(i, i + 17));
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    agentRequests: () => requests.filter((r) => r.url === "/v1/ai/agent/stream"),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export const done = (stop_reason, usd = 0.01) => ({
  type: "done",
  stop_reason,
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
  billing: { method: "wallet", usd_charged: usd },
});
