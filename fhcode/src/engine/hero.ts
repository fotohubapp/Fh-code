/**
 * The FOTOhub API hero: what FH Code draws at the top of the terminal before
 * the engine starts. On the engine's main-screen layout it stays above the
 * engine's own output and scrolls with it, as a header does.
 */

import { fmt } from "../account/guard.js";

const GLYPHS: Record<string, [string, string]> = {
  F: ["█▀▀", "█▀ "],
  O: ["█▀█", "█▄█"],
  T: ["▀█▀", " █ "],
  h: ["█ █", "█▀█"],
  u: ["█ █", "█▄█"],
  b: ["█▄▄", "█▄█"],
  A: ["▄▀█", "█▀█"],
  P: ["█▀█", "█▀▀"],
  I: ["█", "█"],
  " ": [" ", " "],
};

/** The FOTOhub gradient: violet, fuchsia, rose. */
const STOPS: [number, number, number][] = [
  [124, 58, 237],
  [192, 38, 211],
  [244, 63, 94],
];

export function gradientRgb(t: number): [number, number, number] {
  const x = Math.min(Math.max(t, 0), 1) * (STOPS.length - 1);
  const i = Math.min(Math.floor(x), STOPS.length - 2);
  const f = x - i;
  return STOPS[i].map((v, k) => Math.round(v + (STOPS[i + 1][k] - v) * f)) as [number, number, number];
}

export interface HeroInfo {
  version: string;
  columns: number;
  signedIn: boolean;
  account?: string;
  plan?: string;
  balanceUsd?: number | null;
  model?: string;
  cwd?: string;
  color?: boolean;
}

export const HERO_ACTIONS: [string, string][] = [
  ["/fotohub:design", "a stunning site with FOTOhub imagery"],
  ["/fotohub:generate", "image · video · audio · 3D"],
  ["/fotohub:ask", "Gemini, GPT, Nova: a second opinion"],
  ["/budget", "cap this session's spend"],
];

const money = fmt;

/** Visible width of a string with ANSI colours. */
export function visibleWidth(s: string): number {
  return [...s.replace(/\x1b\[[0-9;]*m/g, "")].length;
}

export function renderHero(info: HeroInfo): string {
  const color = info.color !== false;
  const rgb = (c: [number, number, number], s: string, bold = false) => (color ? `\x1b[${bold ? "1;" : ""}38;2;${c[0]};${c[1]};${c[2]}m${s}\x1b[0m` : s);
  const dim = (s: string) => (color ? `\x1b[2m${s}\x1b[0m` : s);
  const bold = (s: string) => (color ? `\x1b[1m${s}\x1b[0m` : s);
  const amber = (s: string) => (color ? `\x1b[38;2;251;191;36m${s}\x1b[0m` : s);

  const who = info.signedIn
    ? [info.account, info.plan].filter(Boolean).join(" · ") || "signed in to FOTOhub"
    : amber("not signed in · /login");
  const wallet = !info.signedIn ? "" : info.balanceUsd === undefined || info.balanceUsd === null ? "wallet ?" : info.balanceUsd < 1 ? amber(`wallet $${money(info.balanceUsd)} · top up`) : `wallet $${money(info.balanceUsd)}`;
  const status = [wallet, info.model].filter(Boolean).join(dim(" · "));
  const brand = `${rgb(gradientRgb(0.5), "FH Code", true)} ${dim(`v${info.version}`)}`;

  // Narrow terminals: one line.
  if (info.columns < 64) {
    return `\n ${rgb(gradientRgb(0), "FOTOhub", true)}${rgb(gradientRgb(1), " API", true)} ${dim("·")} ${brand}${status ? ` ${dim("·")} ${status}` : ""}\n\n`;
  }

  const text = "FOTOhub API";
  const width = [...text].reduce((n, ch) => n + (GLYPHS[ch]?.[0].length ?? 1) + 1, 0);
  const rows = [0, 1].map((r) => {
    let col = 0;
    let out = "";
    for (const ch of text) {
      const glyph = (GLYPHS[ch] ?? [ch, " "])[r];
      [...glyph].forEach((cell, k) => (out += cell === " " ? " " : rgb(gradientRgb((col + k) / width), cell, true)));
      out += " ";
      col += glyph.length + 1;
    }
    return out;
  });
  const inner = Math.min(info.columns - 4, 100);
  const side = (left: string, right: string) => {
    const gap = inner - visibleWidth(left) - visibleWidth(right);
    return `  ${left}${" ".repeat(Math.max(gap, 2))}${right}`;
  };
  const rule = Array.from({ length: inner }, (_, i) => rgb(gradientRgb(i / Math.max(inner - 1, 1)), "━")).join("");

  const lines = ["", side(rows[0], brand), side(rows[1], dim(who)), `  ${rule}`];
  const tag = dim("AI images · video · audio · 3D · text models · code — one API");
  lines.push(side(tag, status));
  // Quick actions, two to a line when there is room.
  const cell = (cmd: string, what: string) => `${rgb(gradientRgb(0.35), "›")} ${bold(cmd.padEnd(20))}${dim(what)}`;
  const cells = HERO_ACTIONS.map(([cmd, what]) => cell(cmd, what));
  const column = Math.max(...cells.filter((_, i) => i % 2 === 0).map(visibleWidth)) + 3;
  const twoUp = column + Math.max(...cells.filter((_, i) => i % 2 === 1).map(visibleWidth)) <= inner;
  for (let i = 0; i < cells.length; i += twoUp ? 2 : 1) {
    const right = twoUp ? (cells[i + 1] ?? "") : "";
    lines.push(`  ${cells[i]}${right ? " ".repeat(column - visibleWidth(cells[i])) + right : ""}`);
  }
  if (info.cwd) lines.push(`  ${dim(`${info.cwd} · docs.fotohub.app · /fh for the panel`)}`);
  lines.push("", "");
  return lines.join("\n");
}
