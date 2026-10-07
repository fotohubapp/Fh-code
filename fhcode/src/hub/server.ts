/**
 * `fhcode hub`: a local web dashboard for the agent hub. It lists background
 * agents with status, cost and output, starts and stops them, and shows the
 * FOTOhub wallet and saved sessions.
 *
 * It listens on 127.0.0.1 only, and every API call needs the random token
 * printed at startup, so other sites open in the browser cannot drive it.
 */

import http from "node:http";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fmt } from "../account/guard.js";
import { FotohubClient } from "../api/client.js";
import { isPermissionMode } from "../agent/permissions.js";
import { listSessions } from "../sessions.js";
import { VERSION } from "../version.js";
import { getHubAgent, listHubAgents, readEvents, startHubAgent, stopHubAgent } from "./store.js";

export interface HubServerOptions {
  port?: number;
  apiKey?: string;
  baseUrl?: string;
  /** Default working directory for agents started from the dashboard. */
  cwd: string;
}

export async function startHubServer(options: HubServerOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const token = randomBytes(18).toString("base64url");
  const client = options.apiKey ? new FotohubClient({ apiKey: options.apiKey, baseUrl: options.baseUrl, userAgent: `fh-code/${VERSION}` }) : undefined;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status: number, body: unknown, type = "application/json") => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(type === "application/json" ? JSON.stringify(body) : String(body));
    };
    try {
      if (req.method === "GET" && url.pathname === "/") {
        if (url.searchParams.get("token") !== token) return send(403, "Open the URL printed by fhcode hub.", "text/plain");
        return send(200, dashboardHtml(token, options.cwd), "text/html; charset=utf-8");
      }
      if (req.headers["x-fh-token"] !== token) return send(403, { error: "bad token" });

      if (req.method === "GET" && url.pathname === "/api/agents") return send(200, listHubAgents().map(summary));
      const m = /^\/api\/agents\/([\w-]+)(\/stop)?$/.exec(url.pathname);
      if (m && req.method === "GET" && !m[2]) {
        const a = getHubAgent(m[1]);
        return send(200, { ...summary(a), output: a.output, error: a.error, prompt: a.prompt, events: readEvents(m[1]).slice(-200) });
      }
      if (m && req.method === "POST" && m[2]) return send(200, { stopped: stopHubAgent(m[1]) });
      if (req.method === "POST" && url.pathname === "/api/agents") {
        const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
        const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
        if (!prompt) return send(400, { error: "prompt is required" });
        const mode = typeof body.mode === "string" && isPermissionMode(body.mode) ? body.mode : "accept-edits";
        const cwd = typeof body.cwd === "string" && body.cwd.trim() ? path.resolve(options.cwd, body.cwd.trim()) : options.cwd;
        const allow = typeof body.allow === "string" ? body.allow.split(",").map((s) => s.trim()).filter(Boolean) : [];
        const meta = startHubAgent({ prompt, cwd, mode, name: typeof body.name === "string" ? body.name : undefined, allowTools: allow });
        return send(201, meta);
      }
      if (req.method === "GET" && url.pathname === "/api/wallet") {
        if (!client) return send(200, { error: "No FOTOhub API key; run fhcode login." });
        const [balance, tier] = await Promise.all([client.getBalance(), client.getCurrentTier().catch(() => undefined)]);
        return send(200, {
          balance: fmt(balance.wallet.balance_usd),
          spent: fmt(balance.spend.this_month_usd),
          limit: balance.spend.monthly_limit_usd === null ? null : fmt(balance.spend.monthly_limit_usd),
          tier: tier?.tier,
          rpm: tier?.limits?.rpm,
        });
      }
      if (req.method === "GET" && url.pathname === "/api/sessions") {
        return send(200, listSessions().slice(0, 30).map((s) => ({ id: s.id, title: s.title, cwd: s.cwd, updatedAt: s.updatedAt })));
      }
      send(404, { error: "not found" });
    } catch (err) {
      send(500, { error: (err as Error).message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 7878, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/?token=${token}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function summary(a: ReturnType<typeof getHubAgent>) {
  return {
    id: a.id,
    name: a.name,
    status: a.status,
    cost: fmt(a.costUsd),
    turns: a.turns,
    toolCalls: a.toolCalls,
    lastActivity: a.lastActivity,
    cwd: a.cwd,
    mode: a.mode,
    startedAt: a.startedAt,
  };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (d: Buffer) => {
      body += d.toString();
      if (body.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(body || "{}"));
    req.on("error", reject);
  });
}

function dashboardHtml(token: string, cwd: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FH Code hub</title>
<style>
:root{--bg:#fafafa;--panel:#fff;--text:#18181b;--muted:#71717a;--border:#e4e4e7;--accent:#7c3aed;--ok:#15803d;--bad:#b91c1c;--run:#1d4ed8}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0f;--panel:#16161d;--text:#ececf1;--muted:#9a9aa8;--border:#2a2a35;--accent:#a78bfa;--ok:#4ade80;--bad:#f87171;--run:#60a5fa}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)}
h1{font-size:18px;margin:0}h1 span{color:var(--accent)}h2{font-size:15px;margin:0 0 10px}
main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;padding:16px 20px;max-width:1400px;margin:0 auto}
@media (max-width:900px){main{grid-template-columns:1fr}}
section{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px}
.wallet{color:var(--muted)}.wallet b{color:var(--text)}
textarea,input,select{width:100%;font:inherit;color:inherit;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px}
textarea{min-height:90px;resize:vertical}.row{display:flex;gap:8px;margin-top:8px}.row>*{flex:1}
button{font:inherit;border:0;border-radius:6px;padding:8px 14px;background:var(--accent);color:#fff;cursor:pointer}button.ghost{background:transparent;color:var(--muted);border:1px solid var(--border);padding:4px 10px}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:7px 6px;border-bottom:1px solid var(--border);vertical-align:top}th{color:var(--muted);font-weight:500;font-size:12px}
tr.sel{background:color-mix(in srgb,var(--accent) 10%,transparent)}tbody tr{cursor:pointer}
.pill{font-size:12px;padding:1px 8px;border-radius:99px;border:1px solid currentColor}.running{color:var(--run)}.done{color:var(--ok)}.failed,.exited{color:var(--bad)}.stopped{color:var(--muted)}
pre{white-space:pre-wrap;word-break:break-word;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px;max-height:60vh;overflow:auto;font:12px/1.5 ui-monospace,Menlo,monospace}
.muted{color:var(--muted)}.full{grid-column:1/-1}
</style></head><body>
<header><h1><span>FH Code</span> hub</h1><div class="wallet" id="wallet">Wallet …</div></header>
<main>
<section><h2>New background agent</h2>
<textarea id="prompt" placeholder="What should the agent do? It works on its own, so give it the whole task."></textarea>
<div class="row"><input id="name" placeholder="Name (optional)"><input id="cwd" placeholder="Directory (default: ${escapeHtml(cwd)})"></div>
<div class="row"><select id="mode"><option value="accept-edits">accept-edits: may edit files</option><option value="plan">plan: read-only</option><option value="yolo">yolo: edits and commands</option></select>
<input id="allow" placeholder='Allowed commands, e.g. Bash(npm test:*)'></div>
<div class="row"><button id="start">Start agent</button></div></section>
<section><h2>Agent</h2><div id="detail" class="muted">Select an agent.</div></section>
<section class="full"><h2>Agents</h2><table><thead><tr><th>Status</th><th>Name</th><th>Cost</th><th>Turns</th><th>Last tool</th><th>Started</th><th></th></tr></thead><tbody id="agents"></tbody></table></section>
<section class="full"><h2>Recent sessions</h2><div id="sessions" class="muted">…</div></section>
</main>
<script>
const T=${JSON.stringify(token)};let sel=null;
const api=(p,o={})=>fetch(p,{...o,headers:{'x-fh-token':T,'content-type':'application/json'}}).then(r=>r.json());
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function wallet(){const w=await api('/api/wallet');document.getElementById('wallet').innerHTML=w.error?esc(w.error):'Wallet <b>$'+esc(w.balance)+'</b> · this month $'+esc(w.spent)+(w.limit?' of $'+esc(w.limit):'')+(w.tier?' · '+esc(w.tier):'');}
async function agents(){const list=await api('/api/agents');document.getElementById('agents').innerHTML=list.map(a=>'<tr data-id="'+esc(a.id)+'" class="'+(a.id===sel?'sel':'')+'"><td><span class="pill '+esc(a.status)+'">'+esc(a.status)+'</span></td><td>'+esc(a.name)+'<div class="muted">'+esc(a.cwd)+'</div></td><td>$'+esc(a.cost)+'</td><td>'+a.turns+'</td><td>'+esc(a.lastActivity??'')+'</td><td>'+new Date(a.startedAt).toLocaleString()+'</td><td>'+(a.status==='running'?'<button class="ghost" data-stop="'+esc(a.id)+'">Stop</button>':'')+'</td></tr>').join('')||'<tr><td colspan="7" class="muted">No agents yet.</td></tr>';}
async function detail(){if(!sel)return;const a=await api('/api/agents/'+sel);document.getElementById('detail').innerHTML='<div><b>'+esc(a.name)+'</b> <span class="pill '+esc(a.status)+'">'+esc(a.status)+'</span> <span class="muted">$'+esc(a.cost)+' · '+a.turns+' turns · '+a.toolCalls+' tool calls · '+esc(a.mode)+'</span></div><p class="muted">'+esc(a.prompt)+'</p>'+(a.error?'<pre style="color:var(--bad)">'+esc(a.error)+'</pre>':'')+'<pre>'+esc(a.output||'(no output yet)')+'</pre>';}
async function sessions(){const s=await api('/api/sessions');document.getElementById('sessions').innerHTML=s.length?'<table><tbody>'+s.map(x=>'<tr><td>'+esc(x.title||x.id)+'<div class="muted">'+esc(x.cwd)+'</div></td><td class="muted">fhcode --resume '+esc(x.id)+'</td><td class="muted">'+new Date(x.updatedAt).toLocaleString()+'</td></tr>').join('')+'</tbody></table>':'No saved sessions.';}
document.getElementById('agents').onclick=async e=>{const stop=e.target.closest('[data-stop]');if(stop){await api('/api/agents/'+stop.dataset.stop+'/stop',{method:'POST'});return refresh();}const tr=e.target.closest('tr[data-id]');if(tr){sel=tr.dataset.id;refresh();}};
document.getElementById('start').onclick=async()=>{const body={prompt:prompt.value,name:document.getElementById('name').value,cwd:document.getElementById('cwd').value,mode:mode.value,allow:allow.value};if(!body.prompt.trim())return;const r=await api('/api/agents',{method:'POST',body:JSON.stringify(body)});if(r.error)return alert(r.error);sel=r.id;prompt.value='';refresh();};
function refresh(){agents();detail();}
wallet();sessions();refresh();setInterval(refresh,2500);setInterval(wallet,30000);
</script></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
