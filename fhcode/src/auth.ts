/**
 * Signing in to a FOTOhub account from the browser, the same flow as the
 * FOTOhub CLI (`fotohub auth login`):
 *
 *   1. FH Code listens on 127.0.0.1 (a port in 19280-19290) and opens
 *      https://fotohub.app/cli-auth?state=<random>&redirect_uri=http://localhost:<port>/callback
 *   2. The person signs in on fotohub.app, which redirects to the callback with
 *      `key` (an fh_live_ API key), `state`, and optionally `email` and `plan`.
 *   3. FH Code checks the state, checks the key against the wallet, and saves
 *      it to ~/.fhcode/config.json (0600).
 */

import http from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { FotohubClient } from "./api/client.js";
import { updateConfigFile } from "./config.js";
import { VERSION } from "./version.js";

export const AUTH_BASE = process.env.FHCODE_AUTH_BASE || "https://fotohub.app";
const CALLBACK_PORTS = [19280, 19290] as const;

export interface LoginResult {
  apiKey: string;
  email?: string;
  plan?: string;
  balanceUsd?: number;
}

export interface BrowserLoginOptions {
  baseUrl?: string;
  /** Called with the sign-in URL once the callback listens. */
  onUrl?: (url: string) => void;
  /** Open the browser (default true). */
  open?: boolean;
  timeoutMs?: number;
  /** Ports to try for the callback; for tests. */
  ports?: readonly [number, number];
}

export async function browserLogin(options: BrowserLoginOptions = {}): Promise<LoginResult> {
  const state = randomBytes(16).toString("hex");
  const server = http.createServer();
  const port = await listenOnFreePort(server, options.ports ?? CALLBACK_PORTS);
  const callback = `http://localhost:${port}/callback`;
  const url = `${AUTH_BASE}/cli-auth?state=${state}&redirect_uri=${encodeURIComponent(callback)}`;

  try {
    const received = await new Promise<{ key: string; email?: string; plan?: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Sign-in timed out after 5 minutes.")), options.timeoutMs ?? 5 * 60_000);
      server.on("request", (req, res) => {
        const u = new URL(req.url ?? "/", callback);
        if (u.pathname !== "/callback") {
          res.writeHead(404).end("Not found");
          return;
        }
        const fail = (status: number, message: string) => {
          res.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(page(false, message));
          clearTimeout(timer);
          reject(new Error(message));
        };
        const error = u.searchParams.get("error");
        if (error) return fail(200, error);
        if (u.searchParams.get("state") !== state) return fail(400, "The sign-in did not come from this FH Code session. Try again.");
        const key = u.searchParams.get("key");
        if (!key || !key.startsWith("fh_")) return fail(400, "fotohub.app sent no API key.");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page(true));
        clearTimeout(timer);
        resolve({ key, email: u.searchParams.get("email") ?? undefined, plan: u.searchParams.get("plan") ?? undefined });
      });
      options.onUrl?.(url);
      if (options.open !== false) openBrowser(url);
    });
    const checked = await saveKey(received.key, options.baseUrl);
    return { ...checked, email: received.email, plan: received.plan };
  } finally {
    server.close();
  }
}

/** Checks a key against the wallet and saves it. */
export async function saveKey(apiKey: string, baseUrl?: string): Promise<LoginResult> {
  const balance = await new FotohubClient({ apiKey, baseUrl, userAgent: `fh-code/${VERSION}` }).getBalance();
  updateConfigFile({ apiKey });
  return { apiKey, balanceUsd: balance.wallet?.balance_usd };
}

export function logout(): void {
  updateConfigFile({ apiKey: undefined });
}

async function listenOnFreePort(server: http.Server, [from, to]: readonly [number, number]): Promise<number> {
  for (let port = from; port <= to; port++) {
    const ok = await new Promise<boolean>((resolve) => {
      const onError = () => {
        server.off("listening", onListening);
        resolve(false);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(true);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });
    if (ok) return port;
  }
  throw new Error(`No free port for the sign-in callback in ${from}-${to}. Use fhcode login --manual.`);
}

export function openBrowser(url: string): void {
  // $BROWSER, the usual convention, wins: a headless machine or a test sets it.
  if (process.env.BROWSER) {
    const child = spawn(`${process.env.BROWSER} "${url.replace(/"/g, "%22")}"`, { shell: true, stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
    return;
  }
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // The URL is printed too.
  }
}

function page(ok: boolean, message = ""): string {
  const esc = message.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return `<!doctype html><html><head><meta charset="utf-8"><title>FH Code · FOTOhub</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0b;color:#fff;font-family:system-ui,-apple-system,sans-serif}
.card{text-align:center;padding:3rem;border-radius:1rem;background:#151517;border:1px solid rgba(255,255,255,.08);max-width:420px}
h1{margin:.5rem 0;font-size:1.5rem;background:linear-gradient(135deg,#7c3aed,#c026d3,#f43f5e);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
p{color:rgba(255,255,255,.6);line-height:1.5}code{color:#a78bfa}</style></head><body><div class="card">
${ok ? `<div style="font-size:2.5rem">✓</div><h1>Signed in to FOTOhub</h1><p>You can close this window and return to <code>FH Code</code>.</p>` : `<div style="font-size:2.5rem">✗</div><h1>Sign-in failed</h1><p>${esc}</p><p>Try again in FH Code.</p>`}
</div></body></html>`;
}
