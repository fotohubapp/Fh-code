/**
 * Configuration for FH Code (FOTOhub Code).
 *
 * Precedence for every setting: command-line flag, then environment variable,
 * then ~/.fhcode/config.json. The API key also falls back to the FOTOhub CLI's
 * ~/.fotohub/config.json, so a user logged in with `fotohub auth login --manual`
 * does not have to log in twice.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from "./api/client.js";
import type { PermissionMode } from "./agent/permissions.js";
import { DEFAULT_DOCS_SOURCE } from "./tools/docs.js";

export interface FhcodeConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  mode?: PermissionMode;
  /** Base URL of the markdown source of docs.fotohub.app. */
  docsSource?: string;
  /** Endpoint returning account limits as JSON (see AccountLimits); defaults to the FOTOhub API. */
  accountLimitsUrl?: string;
  /** JSON manifest announcing the latest FH Code release. */
  updateUrl?: string;
  /** Hard cap per session in USD. */
  maxBudgetUsd?: number;
}

export const CONFIG_DIR = process.env.FHCODE_CONFIG_DIR || path.join(os.homedir(), ".fhcode");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const FOTOHUB_CLI_CONFIG = path.join(os.homedir(), ".fotohub", "config.json");

export const DEFAULT_UPDATE_URL = "https://api.github.com/repos/fotohubapp/Fh-code/releases/latest";

function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function readConfigFile(): FhcodeConfig {
  return readJson(CONFIG_FILE) as FhcodeConfig;
}

export function updateConfigFile(partial: Partial<FhcodeConfig>): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const next = { ...readConfigFile(), ...partial };
  for (const key of Object.keys(next) as (keyof FhcodeConfig)[]) {
    if (next[key] === undefined) delete next[key];
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  chmodSync(CONFIG_FILE, 0o600);
}

export function resolveConfig(flags: Partial<FhcodeConfig> = {}): FhcodeConfig {
  const file = readConfigFile();
  const env = process.env;
  const budget = flags.maxBudgetUsd ?? numberFromEnv(env.FHCODE_MAX_BUDGET_USD) ?? file.maxBudgetUsd;
  return {
    apiKey: flags.apiKey || env.FOTOHUB_API_KEY || file.apiKey || (readJson(FOTOHUB_CLI_CONFIG).apiKey as string | undefined),
    baseUrl: flags.baseUrl || env.FOTOHUB_BASE_URL || file.baseUrl || DEFAULT_BASE_URL,
    model: flags.model || env.FHCODE_MODEL || file.model || DEFAULT_MODEL,
    mode: flags.mode || (env.FHCODE_MODE as PermissionMode | undefined) || file.mode || "default",
    docsSource: flags.docsSource || env.FHCODE_DOCS_SOURCE || file.docsSource || DEFAULT_DOCS_SOURCE,
    accountLimitsUrl: flags.accountLimitsUrl || env.FHCODE_ACCOUNT_LIMITS_URL || file.accountLimitsUrl,
    updateUrl: flags.updateUrl || env.FHCODE_UPDATE_URL || file.updateUrl || DEFAULT_UPDATE_URL,
    maxBudgetUsd: budget,
  };
}

function numberFromEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function maskKey(key: string): string {
  return key.length > 14 ? `${key.slice(0, 12)}...${key.slice(-4)}` : "****";
}
