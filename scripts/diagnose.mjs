#!/usr/bin/env node
/**
 * Measures every brand in a config the same way the page does, and writes a
 * diagnostic report. Structure only — no screenshots. Run it after build.mjs so
 * the report describes what the page will actually choose at runtime.
 *
 *   node diagnose.mjs --html out/eight-brands.html --out out/quality.json
 *   node diagnose.mjs --config assets/brands.json --build-out out/index.html
 *   node diagnose.mjs --html out/index.html --playwright ./node_modules/playwright/index.mjs
 *
 * The measurement runs the real page in a headless browser, so the numbers are
 * the ones the renderer derives, not a second implementation that can drift.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

// Two input modes, both real: --html diagnoses an already-built page, --config
// builds it first and then diagnoses. The --config flag used to be documented
// but ignored, which meant a run could silently report on a stale HTML file.
let htmlPath = args.html ? resolve(args.html) : null;
if (!htmlPath) {
  if (args.config) {
    const cfg = resolve(args.config);
    const tmpOut = resolve(args.buildOut ?? resolve(root, "out/index.html"));
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(
      process.execPath,
      [resolve(root, "scripts/build.mjs"), "--config", cfg, "--out", tmpOut],
      { stdio: "inherit" }
    );
    if (r.status !== 0) throw new Error("build failed; fix the config before diagnosing");
    htmlPath = tmpOut;
  } else {
    htmlPath = resolve(root, "out/index.html");
  }
}
const outPath = resolve(args.out ?? resolve(root, "out/quality.json"));

async function loadPlaywright(explicit) {
  // Resolve from the consumer's own dependency tree. Never hard-code a path to
  // the author's machine: it works there and fails silently everywhere else.
  // An explicit --playwright is the escape hatch for unusual installs, and it
  // lives on the command line rather than in source.
  const tried = [];
  const specifiers = [];
  if (explicit) specifiers.push(explicit);
  specifiers.push("playwright", "playwright-core");

  for (const spec of specifiers) {
    try {
      const mod = await import(spec);
      return mod;
    } catch {
      tried.push(spec);
    }
  }

  throw new Error(
    "diagnose needs Playwright.\n" +
    "  cd <skill>/scripts && npm install && npx playwright install chromium\n" +
    "  or point at an existing install: --playwright <path-or-file-url>\n" +
    "Tried: " + tried.join(", ")
  );
}

const pw = await loadPlaywright(args.playwright);
const browser = await pw.chromium.launch({ headless: true, args: ["--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 2 });

await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
await page.waitForTimeout(2500);

// The page stashes live instances for exactly this kind of inspection.
const data = await page.evaluate(() => {
  const cards = window.__brandLines?.cards ?? [];
  return cards.map((c) => ({
    id: c.brand.id,
    name: c.brand.name,
    grid: c.data.grid,
    features: c.data.features,
    crop: c.data.crop,
    inkAspect: +(c.logo.w / c.logo.h).toFixed(3),
    lines: c.lines.length,
    segments: c.nSeg,
    spacing: +c.spacing.toFixed(2),
    segPitch: +c.segPitch.toFixed(2),
    boxes: c.boxes.length,
    dpr: +c.dpr.toFixed(2),
    frameW: Math.round(c.logo.w),
    frameH: Math.round(c.logo.h),
    cardW: Math.round(c.w),
    visible: c.visible !== false,
    canvas: [c.canvas.width, c.canvas.height]
  }));
});

// Cards that actually render, not cards that exist. Measured after layout so a
// long page reports the load the frame budget is really paying for.
const rendered = data.filter((d) => d.visible).length;

const frames = await page.evaluate(
  () =>
    new Promise((res) => {
      const f = [];
      let last = performance.now();
      let n = 0;
      function go() {
        const now = performance.now();
        f.push(now - last);
        last = now;
        if (++n < 70) requestAnimationFrame(go);
        else {
          f.sort((a, b) => a - b);
          res({
            p50: +f[Math.floor(f.length * 0.5)].toFixed(1),
            p95: +f[Math.floor(f.length * 0.95)].toFixed(1)
          });
        }
      }
      requestAnimationFrame(go);
    })
);

const renderer = await page.evaluate(() => {
  try {
    const c = document.createElement("canvas");
    const g = c.getContext("webgl");
    const ext = g.getExtension("WEBGL_debug_renderer_info");
    return ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
  } catch {
    return "unavailable";
  }
});

await browser.close();

const report = {
  generator: "brand-lines v1.0",
  generatedAt: new Date().toISOString(),
  html: htmlPath,
  environment: {
    renderer,
    viewport: { width: 1800, height: 1200 },
    deviceScaleFactor: 2,
    note: "measured headless; not a claim about other devices"
  },
  performance: {
    ...frames,
    visibleCards: rendered,
    totalCards: data.length,
    budget: { p50: 16.7, p95: 24 },
    // Both percentiles must be inside budget. Grading only p50 lets a stutter
    // (p95 far above budget) report as a pass, which is the failure this
    // number exists to catch.
    verdict:
      frames.p50 <= 16.7 && frames.p95 <= 24 ? "at-budget"
      : frames.p50 <= 24 ? "p50-ok-p95-over"
      : "over-budget",
    overBudget: {
      p50: frames.p50 > 16.7,
      p95: frames.p95 > 24
    }
  },
  brands: data.map((d) => {
    const perLine = d.lines ? (d.segments * d.lines) : 0;
    const thin = d.features.ink;
    const cell = 384 / d.grid;    return {
      id: d.id,
      name: d.name,
      sampling: {
        grid: d.grid,
        min_feature_px: thin,
        min_gap_px: d.features.gap,
        cell_px: +cell.toFixed(2),
        // The grid choice depends on BOTH ink and gap. Reporting only ink let a
        // too-narrow counter pass as fine while the knockout was being lost.
        keeps_thin_stroke: thin >= cell * 0.85,
        keeps_thin_gap: d.features.gap >= cell * 0.85,
        keeps_features: thin >= cell * 0.85 && d.features.gap >= cell * 0.85,
        coverage: +d.features.coverage.toFixed(3),
        crop: d.crop
      },
      frame: {
        w: d.frameW,
        h: d.frameH,
        fill_of_card: +(d.frameW / d.cardW).toFixed(3)
      },
      strokes: {
        lines: d.lines,
        segments: d.segments,
        rects_per_frame: perLine,
        spacing_px: d.spacing,
        segment_px: d.segPitch
      },
      detection_boxes: d.boxes,
      ink_aspect: d.inkAspect,
      canvas: d.canvas,
      dpr: d.dpr
    };
  })
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

console.log(`wrote ${outPath}`);
console.log(`  frames  p50 ${report.performance.p50}ms  p95 ${report.performance.p95}ms  (${report.performance.verdict})`);
for (const b of report.brands) {
  const flag = b.sampling.keeps_features ? "" : "  ← feature lost at this grid";
  console.log(`  · ${b.id.padEnd(10)} grid ${b.sampling.grid}  ink ${b.sampling.min_feature_px}px  gap ${b.sampling.min_gap_px}px  ${b.strokes.rects_per_frame} rects${flag}`);
}
