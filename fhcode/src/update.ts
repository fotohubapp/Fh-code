/**
 * Updates of FH Code from FOTOhub.
 *
 * The update channel is a URL that announces the latest release. Two formats
 * are understood:
 *   - the GitHub "latest release" API of fotohubapp/Fh-code (the default), whose
 *     release carries the npm tarball built by .github/workflows/agent-release.yml;
 *   - a plain JSON manifest {"version": "0.2.0", "tarball": "https://...tgz",
 *     "notes": "https://..."}, for serving updates from fotohub.app.
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./config.js";
import { VERSION } from "./version.js";

export interface UpdateInfo {
  version: string;
  tarball: string;
  notes?: string;
}

const CHECK_FILE = path.join(CONFIG_DIR, "update-check.json");
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function fetchLatest(updateUrl: string, fetchImpl: typeof fetch = fetch): Promise<UpdateInfo | undefined> {
  const res = await fetchImpl(updateUrl, {
    headers: { Accept: "application/json", "User-Agent": `fh-code/${VERSION}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Update check failed: HTTP ${res.status} from ${updateUrl}`);
  return parseManifest(await res.json());
}

export function parseManifest(data: unknown): UpdateInfo | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  if (typeof d.version === "string" && typeof d.tarball === "string") {
    return { version: d.version.replace(/^v/, ""), tarball: d.tarball, notes: typeof d.notes === "string" ? d.notes : undefined };
  }
  if (typeof d.tag_name === "string" && Array.isArray(d.assets)) {
    const asset = (d.assets as Array<Record<string, unknown>>).find(
      (a) => typeof a.name === "string" && a.name.endsWith(".tgz") && typeof a.browser_download_url === "string",
    );
    if (!asset) return undefined;
    return {
      version: d.tag_name.replace(/^(fhcode-|agent-)?v/, ""),
      tarball: asset.browser_download_url as string,
      notes: typeof d.html_url === "string" ? d.html_url : undefined,
    };
  }
  return undefined;
}

/** True when version a is newer than b (numeric major.minor.patch, pre-release suffixes ignored). */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return false;
}

/** Checks at most once a day and never throws; returns an available update. */
export async function backgroundUpdateCheck(updateUrl: string): Promise<UpdateInfo | undefined> {
  if (process.env.FHCODE_NO_UPDATE_CHECK) return undefined;
  try {
    const state = JSON.parse(readFileSync(CHECK_FILE, "utf8")) as { at: number; latest?: UpdateInfo };
    if (Date.now() - state.at < CHECK_INTERVAL_MS) {
      return state.latest && isNewer(state.latest.version, VERSION) ? state.latest : undefined;
    }
  } catch {
    // No previous check.
  }
  try {
    const latest = await fetchLatest(updateUrl);
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(CHECK_FILE, JSON.stringify({ at: Date.now(), latest }));
    return latest && isNewer(latest.version, VERSION) ? latest : undefined;
  } catch {
    return undefined;
  }
}

/** Installs a release globally with npm. Resolves to npm's exit code. */
export function installUpdate(info: UpdateInfo): Promise<number> {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  return new Promise((resolve) => {
    const child = spawn(npm, ["install", "--global", info.tarball], { stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}
