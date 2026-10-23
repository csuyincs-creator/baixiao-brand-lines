# The encoding

Why the piece looks the way it does, and which numbers were measured rather
than guessed.

## 1. One sample per line, not per pixel

The rendered grid is not a pixel grid. Each vertical stroke reads **one**
horizontal sample and a run of vertical samples:

```
table[round((v + noise) * (N-1))][round(u * (N-1))]
```

With 40 strokes across a 400px card, horizontal detail is capped at 40 samples
no matter how fine the table is. That is why a 64 grid is enough for most marks:
64 columns already oversample 40 strokes. Raising to 96 only helps when the
mark's thinnest **vertical** stroke or gap would be averaged away at 64.

The page measures that directly: it scans the probe canvas row-wise and
column-wise, collects run lengths, and takes the 10th percentile so a single
anti-aliased pixel cannot masquerade as a hairline.

```js
const finest = Math.min(features.ink, features.gap);
const grid = finest >= (PROBE / 64) * 0.85 ? 64 : 96;
```

Measured on the eight shipped marks: every one lands on 64, with thinnest
strokes between 13px (Huawei) and 55px (TikTok) in probe space against a 6px
cell. Nothing is lost.

## 2. Four widths, and why four

Brightness is quantised to four classes:

| band | level | width (× spacing) | alpha |
| --- | --- | --- | --- |
| < 0.135 | 0 | not drawn (or faint field) | 0.155 |
| 0.135–0.33 | 1 | 0.09 | 0.38 |
| 0.33–0.60 | 2 | 0.17 | 0.66 |
| ≥ 0.60 | 3 | 0.27 | 1.0 |

Four is the point where the eye still reads discrete "bamboo" joints. At five
or more the classes start to blur back into a gradient and the segmented look
disappears; at three, solid areas lose their internal structure and the mark
reads as a silhouette.

Alpha and width both step with brightness, which is what makes a dark cell read
as "fainter" rather than "thinner" — without the alpha step, the background
field turns noisy and fights the mark.

## 3. The knockouts are load-bearing

A solid mark is mostly one colour; its identity lives in the holes. Xiaomi's
`mi` inside the rounded square, Huawei's five petals with gaps between them.

Two rules protect them:

```js
// noise lifts mid-tones, never fills a hole
b = base + noise * 0.235 * smooth(clamp(base * 3, 0, 1));

// inside the mark, a dark cell is a real hole
if (level === 0 && !outside) continue;
```

The first scales the noise by the sampled tone, so a cell at base 0.02 gets
almost no lift. The second skips the faint background field inside the mark's
bounding frame, letting the card's own background show through the counter.
Without these, both marks smear into blobs — the exact failure this skill exists
to avoid.

## 4. Frames follow the ink, not the canvas

A square frame silently shrinks wide marks. Measured ink aspect ratios:

| mark | aspect |
| --- | --- |
| Apple | 0.82 |
| Google | 0.98 |
| Tesla | 1.00 |
| Xiaomi | 1.00 |
| ByteDance | 1.14 |
| Huawei | 1.33 |
| DeepSeek | 1.36 |
| TikTok | 0.87 |

Huawei and DeepSeek lose about a third of their height if forced into a square.
So the frame is `min(cardWidth × 0.9, bandHeight × aspect)` wide, and the sampled
sub-rect (`crop`) is mapped into it with one uniform factor.

The crop is measured at a deliberately low threshold (0.012 per cell) because a
long tapering tail — TikTok's flag — averages below 0.04 and would be cut off.
Half a cell of padding keeps the outermost stroke from being sheared.

## 4b. Weight follows the ink too

Aspect ratio is only half the story. **Two marks can have identical frame areas
and still look wildly different in weight**, because total ink is
`frameArea × coverage`:

| mark | coverage inside its own box |
| --- | --- |
| Tesla | 0.179 |
| TikTok | 0.251 |
| DeepSeek | 0.261 |
| Google | 0.269 |
| Huawei | 0.292 |
| ByteDance | 0.292 |
| Apple | 0.366 |
| Xiaomi | 0.521 |

With equal frames, the eight-card page measured 25% more ink in its second row
than its first, purely because Xiaomi and ByteDance sit there. A reviewer looking
at the screenshot called it *"the second row is 12–15% too large"* — every frame
was in fact identical. The fix is to equalise weight, not size:

```js
const weightK = clamp(Math.sqrt(0.29 / coverage), 0.78, 1.12);
boxW = Math.min(w * 0.9, bandH * aspect) * weightK;
```

`sqrt` is the right root because area scales with the square of the linear
factor, so this makes `frameArea × coverage` constant. Measured result: row ink
ratio 1.25 → 1.08, per-card coverage now 6.0–8.1%.

Coverage is measured once during sampling over a 64×64 grid of the probe, so it
adds nothing per frame.

## 5. Detection boxes

Boxes come from the table, not from hand placement: the table is divided into
8×8 blocks, blocks are sorted by mean brightness, and the three brightest that
are at least 2.9 blocks apart become targets. Each box is then snapped to the
stroke grid:

```js
bx = x0 + round((cx - bw/2 - x0) / spacing) * spacing;
by = round((cy - bh/2) / segPitch) * segPitch;
```

That snapping is what makes the boxes read as "aligned to the sampling lattice"
rather than floating. Because boxes can collide after snapping, a simple
vertical push-apart pass runs afterwards, then re-snaps.

Confidence is `0.80 + 0.18 × (blockMean / brightestBlockMean)`, so the number in
the chip is derived rather than decorative.

## 6. Motion

- **Noise**: 32×32 value noise, two octaves, drifting down at 0.22 and 0.43
  units/second. It is sampled with nearest-neighbour so cells stay quantised and
  match the stroke rhythm.
- **Pointer scatter**: on move, each nearby line receives an outward impulse
  proportional to pointer travel; a spring (`k = 0.055`, damping `0.925^dt`)
  pulls every line home. A held drag adds a small continuous outward drift so the
  lines stay parted while the pointer moves, then snap back when it stops.
- **Sweep**: one horizontal bar crosses the mark on entry, 1 → 0 over ~38 frames.

All three are skipped under `prefers-reduced-motion`.

## 7. The performance numbers

Measured on Chrome/ANGLE, RTX 3060 Laptop, 1600×950 viewport.

| Configuration | p50 frame |
| --- | --- |
| 3 cards, `stroke()` + round cap per segment | 133 ms |
| 3 cards, batched `roundRect` fill, DPR 2 | 18.5 ms |
| 3 cards, batched fill, DPR 1 | 16.7 ms |
| 8 cards, batched fill, DPR 2, no budget | 63.6 ms |
| 8 cards, DPR budget ~5.2e6 px | 33.8 ms |
| 8 cards, budget + idle throttle | 22.4 ms |

The two changes that matter are the batched fill and the idle throttle. The DPR
budget is what keeps the eight-card case from being twice as slow as the
three-card case.

## 8. What still does not work

- **Pure text marks.** A wordmark with 6px glyph strokes in a 64 grid becomes
  mush regardless of width classes. Keep the type as type.
- **Marks with almost no vertical structure.** ByteDance's logo is four
  full-height solid bars: 162 vertical transitions in the probe, against 262 for
  Apple and 604 for Huawei. There is no horizontal detail to encode, so the
  result reads as a bar chart. That is an honest property of the source, not a
  sampling failure — say so in the delivery note rather than tuning parameters
  until it looks busier than it is.
- **Multi-colour marks with no alpha structure.** Collapsing all channels to one
  brightness throws away the only separation the mark had. Needs per-channel
  sampling, which this template does not do.
- **Marks under ~200px equivalent stroke detail.** The table runs out of data
  before the strokes do.
