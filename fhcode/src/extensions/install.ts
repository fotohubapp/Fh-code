/**
 * Plugin marketplaces and installation.
 *
 * A marketplace is a git repository (or a local directory) with
 * .fhcode-plugin/marketplace.json or .claude-plugin/marketplace.json listing
 * plugins. The FH Code marketplace, fh-code-plugins, is this repository
 * (fotohubapp/Fh-code) and is added automatically on first install.
 *
 *   ~/.fhcode/marketplaces.json            known marketplaces
 *   ~/.fhcode/marketplaces/<name>/         their checkouts
 *   ~/.fhcode/plugins/<plugin>/            installed plugins
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../config.js";
import { PLUGINS_DIR } from "./index.js";

export const DEFAULT_MARKETPLACE = { name: "fh-code-plugins", source: "fotohubapp/Fh-code" };

const REGISTRY = path.join(CONFIG_DIR, "marketplaces.json");
const MARKETPLACES_DIR = path.join(CONFIG_DIR, "marketplaces");

export interface MarketplaceEntry {
  name: string;
  source: string;
  dir: string;
}

export interface MarketplacePlugin {
  name: string;
  description?: string;
  version?: string;
  source: string | { source: string; repo?: string; url?: string; path?: string };
  category?: string;
}

function readRegistry(): Record<string, MarketplaceEntry> {
  try {
    return JSON.parse(readFileSync(REGISTRY, "utf8")) as Record<string, MarketplaceEntry>;
  } catch {
    return {};
  }
}

function writeRegistry(reg: Record<string, MarketplaceEntry>): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(REGISTRY, JSON.stringify(reg, null, 2) + "\n");
}

export function listMarketplaces(): MarketplaceEntry[] {
  return Object.values(readRegistry());
}

function readMarketplaceManifest(dir: string): { name?: string; plugins?: MarketplacePlugin[] } {
  for (const f of [path.join(dir, ".fhcode-plugin", "marketplace.json"), path.join(dir, ".claude-plugin", "marketplace.json")]) {
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8")) as { name?: string; plugins?: MarketplacePlugin[] };
  }
  throw new Error(`No marketplace.json in ${dir}/.fhcode-plugin or ${dir}/.claude-plugin.`);
}

function gitUrl(source: string): string {
  if (/^[\w.-]+\/[\w.-]+$/.test(source)) return `https://github.com/${source}.git`;
  return source;
}

function git(args: string[], cwd?: string): void {
  const r = spawnSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.error?.message || "").trim()}`);
}

/** Adds a marketplace from "owner/repo", a git URL or a local directory. */
export function addMarketplace(source: string): MarketplaceEntry {
  const local = path.resolve(source);
  let dir: string;
  if (existsSync(local)) {
    dir = local;
  } else {
    const tmp = path.join(MARKETPLACES_DIR, `.incoming-${Date.now()}`);
    mkdirSync(MARKETPLACES_DIR, { recursive: true });
    git(["clone", "--depth", "1", gitUrl(source), tmp]);
    dir = tmp;
  }
  const manifest = readMarketplaceManifest(dir);
  const name = manifest.name ?? path.basename(source).replace(/\.git$/, "");
  if (dir !== local) {
    const final = path.join(MARKETPLACES_DIR, name);
    rmSync(final, { recursive: true, force: true });
    cpSync(dir, final, { recursive: true });
    rmSync(dir, { recursive: true, force: true });
    dir = final;
  }
  const reg = readRegistry();
  reg[name] = { name, source, dir };
  writeRegistry(reg);
  return reg[name];
}

export function updateMarketplaces(): string[] {
  const updated: string[] = [];
  for (const m of listMarketplaces()) {
    if (existsSync(path.join(m.dir, ".git"))) {
      git(["pull", "--ff-only"], m.dir);
      updated.push(m.name);
    }
  }
  return updated;
}

export function marketplacePlugins(name: string): MarketplacePlugin[] {
  const m = readRegistry()[name];
  if (!m) throw new Error(`Unknown marketplace ${name}.`);
  return readMarketplaceManifest(m.dir).plugins ?? [];
}

/** Installs "plugin" or "plugin@marketplace"; returns the install directory. */
export function installPlugin(spec: string): string {
  const [pluginName, marketName] = spec.split("@");
  let reg = readRegistry();
  if (!marketName && Object.keys(reg).length === 0) {
    addMarketplace(DEFAULT_MARKETPLACE.source);
    reg = readRegistry();
  }
  const candidates = marketName ? [reg[marketName]].filter(Boolean) : Object.values(reg);
  if (marketName && !candidates.length) {
    if (marketName === DEFAULT_MARKETPLACE.name) candidates.push(addMarketplace(DEFAULT_MARKETPLACE.source));
    else throw new Error(`Unknown marketplace ${marketName}. Add it with: fhcode plugin marketplace add <owner/repo>`);
  }
  for (const market of candidates) {
    const entry = (readMarketplaceManifest(market.dir).plugins ?? []).find((p) => p.name === pluginName);
    if (!entry) continue;
    const target = path.join(PLUGINS_DIR, pluginName);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(PLUGINS_DIR, { recursive: true });
    const src = entry.source;
    if (typeof src === "string") {
      cpSync(path.resolve(market.dir, src), target, { recursive: true });
    } else if (src.source === "github" || src.source === "git" || src.source === "url") {
      git(["clone", "--depth", "1", gitUrl(src.repo ?? src.url ?? ""), target]);
      if (src.path) {
        const sub = path.join(target, src.path);
        const tmp = `${target}.tmp`;
        cpSync(sub, tmp, { recursive: true });
        rmSync(target, { recursive: true, force: true });
        cpSync(tmp, target, { recursive: true });
        rmSync(tmp, { recursive: true, force: true });
      }
    } else {
      throw new Error(`Unsupported plugin source for ${pluginName}: ${JSON.stringify(src)}`);
    }
    return target;
  }
  throw new Error(`Plugin ${pluginName} was not found in ${candidates.map((c) => c.name).join(", ") || "any marketplace"}.`);
}

export function removePlugin(name: string): boolean {
  const target = path.join(PLUGINS_DIR, name);
  if (!existsSync(target)) return false;
  rmSync(target, { recursive: true, force: true });
  return true;
}
