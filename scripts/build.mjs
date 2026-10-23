#!/usr/bin/env node
/**
 * brand-lines generator
 *
 *   node build.mjs --config assets/brands.json --out out/index.html
 *   node build.mjs --config assets/brands.json --out out/index.html --single apple
 *
 * Reads a config that lists N brands (each with an SVG path), injects the data
 * into the template, and writes one self-contained HTML file with no external
 * requests. Everything else — sampling resolution, stroke counts, detection
 * boxes — is derived in the browser at runtime.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const configPath = resolve(args.config ?? resolve(root, "assets/brands.json"));
const outPath = resolve(args.out ?? resolve(root, "out/index.html"));
const templatePath = resolve(args.template ?? resolve(root, "assets/template.html"));

const config = JSON.parse(readFileSync(configPath, "utf8"));
const template = readFileSync(templatePath, "utf8");

// mode is a page-level preset: it changes density and label size, never brand data.
const MODES = { single: 1, triple: 3, gallery: 4 };
const mode = args.mode ?? config.mode ?? "gallery";
if (!(mode in MODES)) {
  throw new Error(`unknown mode "${mode}" (expected one of ${Object.keys(MODES).join(", ")})`);
}

let brands = config.brands ?? [];
if (!Array.isArray(brands) || brands.length === 0) {
  throw new Error("config has no brands[]");
}

// --single narrows the list first, so mode checks see the final set.
if (typeof args.single === "string") {
  const want = args.single;
  brands = brands.filter((b) => b.id === want);
  if (brands.length === 0) throw new Error("no brand with id " + want);
}

// --single implies the single layout. Without this, `--single apple` produced a
// one-card gallery at four-column width, which is not what the flag means.
const effectiveMode = typeof args.single === "string" && !args.mode ? "single" : mode;
const effectiveCols = MODES[effectiveMode];

if (effectiveMode === "single" && brands.length !== 1) {
  throw new Error(`mode "single" needs exactly one brand, got ${brands.length} — pass --single <id>`);
}
if (effectiveMode === "triple" && brands.length > 3) {
  throw new Error(`mode "triple" takes at most three brands, got ${brands.length}`);
}

// Validate before generating: a missing path or palette is a hard error, not a
// silently blank card.
const required = ["id", "name", "tagline", "meta", "path"];
const paletteKeys = ["bg", "bgRgb", "ink", "line", "scan", "scanInk", "edge", "glow"];

for (const b of brands) {
  for (const k of required) {
    if (!b[k] || typeof b[k] !== "string") {
      throw new Error(`brand ${b.id ?? "(no id)"} is missing "${k}"`);
    }
  }
  for (const k of paletteKeys) {
    if (!b.palette || !b.palette[k]) {
      throw new Error(`brand ${b.id} is missing palette.${k}`);
    }
  }
  if (!/^[MmLlHhVvCcSsQqTtAaZz0-9.,\-+eE\s]+$/.test(b.path)) {
    throw new Error(`brand ${b.id} path contains unexpected characters`);
  }

  // The sampler draws paths at a fixed 24-unit scale, so a path authored in a
  // 512 (or 1024) coordinate system lands far outside the probe and yields an
  // all-zero table. That used to build "successfully" into a blank card, so it
  // is a hard error now, with the measured extent in the message.
  const nums = (b.path.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
  const maxAbs = nums.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  if (maxAbs > 40) {
    throw new Error(
      `brand ${b.id} path reaches ${maxAbs.toFixed(1)} units; the sampler expects a 24×24 viewBox. ` +
      `Scale the path (or supply a 24-unit icon) before building — otherwise the card renders empty.`
    );
  }
}

const data = {
  title: config.title ?? "Line Studies",
  description: config.description ?? "",
  wordmark: config.wordmark ?? "Line Studies",
  mastheadMid: config.mastheadMid ?? "",
  mastheadRight: config.mastheadRight ?? "",
  // Copy that names a count must follow the actual brand list, or a one-brand
  // build keeps claiming "eight marks".
  kicker: config.kicker ?? `A luminance study — ${countWord(brands.length)} ${brands.length === 1 ? "mark" : "marks"}`,
  headline: config.headline ?? (brands.length === 1
    ? `${brands[0].name} in <em>lines.</em>`
    : "Reduced to <em>lines.</em>"),
  lede: config.lede ?? (brands.length === 1
    ? `${brands[0].name}, sampled cell by cell and rebuilt from vertical strokes. No images — only width. <b>Hover the card to scan.</b>`
    : `${countWord(brands.length)} marks, sampled cell by cell and rebuilt from vertical strokes. No images — only width. <b>Hover a card to scan.</b>`),
  footerLeft: config.footerLeft ?? brands.map((b) => b.name).join(" / "),
  footerRight: config.footerRight ?? "No libraries · Device-pixel aware",
  brands
};

function countWord(n) {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  return words[n] ?? String(n);
}

let html = template;

const slots = {
  __TITLE__: data.title,
  __DESCRIPTION__: data.description,
  __WORDMARK__: data.wordmark,
  __MASTHEAD_MID__: data.mastheadMid,
  __MASTHEAD_RIGHT__: data.mastheadRight,
  __KICKER__: data.kicker,
  __HEADLINE__: data.headline,
  __LEDE__: data.lede,
  __FOOTER_LEFT__: data.footerLeft,
  __FOOTER_RIGHT__: data.footerRight
};

for (const [token, value] of Object.entries(slots)) {
  html = html.split(token).join(value);
}

// JSON is valid JS once the closing script-tag sequence is escaped.
// The template expects a bare array: const BRANDS = __BRAND_DATA__;
const brandJson = JSON.stringify(brands, null, 2).replace(/<\/script/gi, "<\\/script");

html = html.split("__BRAND_DATA__").join(brandJson);

// Layout preset: set the column cap only — the media queries derive from it,
// so a single-card page stays one column at every width.
html = html.split("--cols-max: 4;").join(`--cols-max: ${effectiveCols};`);
if (effectiveMode === "single") {
  html = html.replace(
    "    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));",
    "    width: 100%;\n    max-width: 560px;\n    margin: 0 auto;\n    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));"
  );
}

const leftover = html.match(/__[A-Z_]+__/g);
if (leftover) {
  throw new Error("unreplaced template slots: " + [...new Set(leftover)].join(", "));
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, "utf8");

// config.json: the resolved inputs plus what the build decided, so a run can be
// reproduced and audited later.
const resolved = {
  generator: "brand-lines v1.0",
  generatedAt: new Date().toISOString(),
  mode: effectiveMode,
  template: templatePath,
  output: outPath,
  page: {
    title: data.title,
    wordmark: data.wordmark,
    kicker: data.kicker,
    headline: data.headline,
    lede: data.lede,
    footerLeft: data.footerLeft,
    footerRight: data.footerRight
  },
  brands
};
const configOut = resolve(args["config-out"] ?? resolve(dirname(outPath), "config.json"));
writeFileSync(configOut, JSON.stringify(resolved, null, 2), "utf8");

const kb = (Buffer.byteLength(html, "utf8") / 1024).toFixed(1);
console.log(`wrote ${basename(outPath)}  ${kb} KB  ${brands.length} brand(s)`);
for (const b of brands) {
  const warn = b.path.length > 1500 ? "  (dense path — check sampling)" : "";
  console.log(`  · ${b.id.padEnd(10)} ${b.name}${warn}`);
}
