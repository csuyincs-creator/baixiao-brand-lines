---
name: brand-lines
description: >
  Turn one or many brand logos into a "luminance study": every mark is sampled
  into a brightness table, then redrawn as bamboo-like vertical strokes whose
  width encodes brightness, with flowing noise, pointer-scatter springs, and
  grid-snapped detection boxes. Produces one self-contained HTML file per run,
  with zero external requests. Use when the user asks for 竖线/竹节/线阵品牌卡,
  "brand logo line art", "luminance to stroke width", or a gallery of logos
  rendered as a procedural canvas piece.
---

# brand-lines

A mark is drawn once into an offscreen canvas, measured cell by cell, and then
never drawn again — every frame after that is vertical strokes reading a table.
The whole piece is one HTML file with no libraries and no image assets.

The hard rule: **the visual is an encoding, not a filter.** A logo only survives
if its strokes and its counters survive the grid. Measure first, then draw.

## What this skill is for

| Situation | Use |
| --- | --- |
| "把 logo 做成竖线/竹节质感" | this skill |
| A gallery of N marks in one visual language | this skill |
| A hero image where the mark must stay recognizable | this skill, `compare=mode:single` |
| A literal vector trace or a logo cleanup job | not this skill |
| A photographic or gradient-heavy mark | this skill only in fidelity mode |

## Input

Caller supplies brand assets and copy. Everything visual is derived.

```jsonc
{
  "mode": "gallery",            // single | triple | gallery  (page-level, not per brand)
  "title": "Line Studies",
  "headline": "Reduced to <em>lines.</em>",
  "lede": "…",
  "brands": [
    {
      "id": "apple",            // required, stable key
      "name": "Apple",          // required, shown in the header
      "tagline": "Simplicity, sampled.",   // required, bottom-left
      "meta": "Cupertino · CA · 1976",     // required, bottom-right
      "path": "M12.152 6.896c-.948 …",     // required, SVG path in a 24×24 box
      "palette": {              // required, all eight keys
        "bg": "#e9e7e0", "bgRgb": "233 231 224", "ink": "#141414",
        "line": "#121212", "scan": "#2c55ff", "scanInk": "#f2f0e9",
        "edge": "rgba(0,0,0,.17)", "glow": "#ffffffcc"
      }
    }
  ]
}
```

Required from the caller: `id`, `name`, `tagline`, `meta`, `path`, `palette`.
Derived by the generator, never asked for:

| Derived | From | Why it is not an input |
| --- | --- | --- |
| ink crop + optical centre | sampled alpha | logos have wildly different padding |
| frame aspect | ink crop | wide marks (Huawei 1.33, DeepSeek 1.36) die in a square |
| sampling grid (64 / 96) | thinnest stroke vs cell | a fixed grid loses thin detail |
| line count / segment pitch | card size | must follow the container, not the brand |
| four width thresholds | table histogram | tied to the sample resolution |
| noise field | seed + time | deterministic, no tuning per brand |
| detection boxes | brightest 8×8 blocks | derived from the mark, not hand-placed |
| DPR | card count × area | the pixel budget is a page property |

`compare` changes page density, not brand data: `single` gives one large mark
with full annotation space; `triple` compresses whitespace and shrinks labels;
`gallery` is a responsive grid of N marks with thumbnail-level labels.

## Output

```
out/
  index.html      required — self-contained, opens offline
  quality.json    required — structural + performance diagnostics, no screenshots
  config.json     required — the resolved config actually used
  gallery.html    only for mode=gallery with per-brand files
  poster.png      on request — a still frame
```

`quality.json` records, per brand: chosen grid, thinnest stroke and narrowest gap in probe pixels,
whether the grid still resolves **both** (`keeps_features` — checking only strokes let a lost counter
report as fine), ink coverage, crop, stroke counts, box count, canvas size, DPR. Plus page-level p50
and p95 frame time, viewport, DPR and GPU renderer string, with a verdict that requires **both**
percentiles to be inside budget.

It reports diagnostics only. It is not a pass/fail gate and it never contains screenshots.

Verification is a separate agent step: screenshot the idle state, a hovered
state, and the full page, then look at them. A clean `quality.json` is not
evidence the piece looks right.

## Build

```bash
cd scripts && npm install && npx playwright install chromium   # once, for diagnose
node scripts/build.mjs --config assets/brands.json --out out/index.html
node scripts/build.mjs --config assets/brands.json --single apple --out out/apple.html
node scripts/diagnose.mjs --html out/index.html --out out/quality.json
```

`--single <id>` builds one brand in the single-brand layout (it implies the layout; you do not pass
`--mode` as well). `diagnose` accepts either `--html` (diagnose an existing build) or `--config`
(build, then diagnose), and `--playwright <path>` for a non-standard Playwright install.

`build.mjs` validates every brand (missing keys, unexpected path characters, and path coordinates
outside a 24-unit box) and fails loudly instead of emitting a blank card. Brand paths are inlined as
JSON, so the result has no network dependency at all.

## Architecture hard constraints

These are not preferences. Every one of them was measured, and violating any of
them is how this piece turns into a stuttering page.

1. **Batch by width class, then fill.** Build four `Path2D` objects, add one
   `roundRect` per segment to the class it belongs to, then `fill()` each once.
2. **Never stroke segment-by-segment.** `stroke()` with `lineCap: round` per
   segment costs ~133 ms/frame for three cards on Chrome/ANGLE; the batched fill
   path costs ~17–22 ms. This is a 6× difference and the single most common way
   an "intuitive" implementation fails.
3. **DPR ≤ 2, and budget it.** Cost scales with cards × DPR². Eight full-frame
   canvases at DPR 2 blew the frame to 63 ms; capping total pixels to ~5.2e6
   brought it back to ~22 ms.
4. **Stop rendering invisible cards.** `IntersectionObserver` out of view stops
   the draw, not just the paint.
5. **Idle cards do not need 60 fps.** Only the hovered card, a revealing card, or
   one mid-sweep runs at the display rate; the rest share a ~30 fps slice.
6. **Release the probe canvas.** Set `width`/`height` to 0 after sampling. Never
   keep the offscreen canvas alive next to its table.
7. **Noise must not fill a knockout.** Scale the noise lift by the sampled tone,
   and skip drawing entirely inside the mark's dark cells so counters stay open.
8. **Structure beats motion.** If fidelity and the frame budget conflict, spend
   the budget in this order: sampling precision → line density → reduce motion →
   lower DPR → fidelity mode.
9. **Equalise ink weight, not frame size.** Total ink is `frameArea × coverage`;
   coverage spans 0.18–0.52 across normal marks, so identical frames produce a
   visibly lopsided page. Scale by `sqrt(REF / coverage)`. Measured: row ink
   ratio 1.25 → 1.08.

## When the encoding fails

Check these before generating, not after.

| Mark | Symptom | Check | Response |
| --- | --- | --- | --- |
| Hairline strokes | vanish in the table | thinnest ink < one cell | raise grid to 96, or widen `line` |
| Solid mark with a counter (Xiaomi `mi`) | counter fills in | counter narrower than ~2 cells | keep knockouts empty, gate noise by tone |
| Wide mark (Huawei, DeepSeek) | shrunk in a square frame | ink aspect > 1.15 | frame follows ink aspect |
| Long tapering tail (TikTok) | tip cropped | table threshold 0.04 misses the tip | crop threshold 0.012 + half-cell padding |
| Dense multi-colour overlay | flat, same width everywhere | colour regions, no alpha structure | separate the channels, or fidelity mode |
| Mark that is mostly text | letters turn to mush | glyph stroke height | icon only; keep text as text |
| Very low-res raster | soft, blobby edges | source pixel size | request SVG first |

**The one pre-check worth running on every mark:** count vertical structure
transitions in the probe (how many times a vertical scanline crosses in and out
of ink). This is how much horizontal detail the encoding has to work with.

| mark | transitions | verdict |
| --- | --- | --- |
| Huawei | 604 | rich, encodes well |
| Google | 466 | rich |
| DeepSeek | 456 | rich |
| Tesla | 444 | rich |
| Xiaomi | 378 | good |
| Apple | 262 | good |
| TikTok | 248 | good |
| ByteDance | 162 | **poor fit** — four solid bars read as a bar chart |

A low count is a property of the source, not a bug. Report it, do not tune
parameters to fake more detail.

When a mark cannot pass, do not force it through four widths. Fall back in this
order:

- **L0 standard** — four width classes, derived grid.
- **L1 enhanced** — finer grid, denser strokes, re-tuned thresholds, still strokes.
- **L2 fidelity** — strokes become the background texture; the real vector is
  drawn on top as the foreground.

## Verification

1. Build. Then read `quality.json`: every brand must report `keeps_features: true`; if a brand fails,
   raise its grid before going further.
2. Screenshot idle, hover, and full page.
3. On the screenshots, check: every mark is recognizable, no mark is cropped, no
   detection chip overlaps a mark's key feature, no label overflows its card.
4. Read the frame numbers. The verdict requires p50 ≤ 16.7 ms **and** p95 ≤ 24 ms at the tested DPR;
   `p50-ok-p95-over` is a real result, not a pass — report it as such. Never claim a device you did
   not measure.

A clean `quality.json` plus a passing screenshot is the bar. Either alone is not.

## Files

```
assets/template.html    the renderer; slots are filled by build.mjs
assets/brands.json      eight worked examples, all shipped defaults
scripts/build.mjs       config → single HTML
scripts/diagnose.mjs    run the page, emit quality.json
reference/encoding.md   why four widths, the thresholds, the noise, the boxes
reference/palettes.md   the eight palettes and when to reuse each
```
