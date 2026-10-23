# Palettes

Every palette is eight values. Six are visible, two keep the card readable at
small sizes.

```jsonc
{
  "bg":      "#e9e7e0",        // card background
  "bgRgb":   "233 231 224",    // same colour, space-separated for rgb(var(--bg-rgb) / .9)
  "ink":     "#141414",        // brand name, tagline, button
  "line":    "#121212",        // the strokes
  "scan":    "#2c55ff",        // detection boxes, chips, coordinates, status
  "scanInk": "#f2f0e9",        // text drawn *on* a filled chip
  "edge":    "rgba(0,0,0,.17)",   // card border
  "glow":    "#ffffffcc"       // top radial highlight
}
```

## The two that are easy to get wrong

**`bgRgb` must match `bg`.** The scrims fade to the card colour with alpha; if
the two drift apart you get a visible band across the header. This happened
during development with a short top scrim — it looked like a seam in the card.

**`scanInk` must contrast with `scan`, not with `bg`.** The chip is a solid fill
of `scan` with `scanInk` text on top. A palette where both are light makes the
`M01 · 0.98` label invisible — the label is drawn but unreadable. Check this pair
first when a chip looks blank.

## The eight shipped palettes

| Brand | bg | line | scan | Character |
| --- | --- | --- | --- | --- |
| Apple | `#e9e7e0` warm paper | `#121212` | `#2c55ff` | the only light card; blue scan reads as annotation |
| Google | `#1b39e0` brand blue | `#a9c4ff` | `#8fe9ff` | light-on-blue, low contrast on purpose |
| Tesla | `#0c0c0e` near black | `#ff2e2e` | `#5b8cff` | red strokes, cold blue scan |
| DeepSeek | `#060a16` deep navy | `#4d6bfe` | `#7ee0ff` | the mark's own blue, dark chip text |
| Xiaomi | `#140d07` warm black | `#ff6900` | `#ffd166` | orange on brown-black |
| Huawei | `#6d020c` deep red | `#ff98a2` | `#ffe08a` | red field, warm scan |
| ByteDance | `#0a1020` blue black | `#5a8cff` | `#4ff0c0` | mint scan against blue strokes |
| TikTok | `#0b0b0d` black | `#25f4ee` | `#fe2c55` | cyan strokes, the brand's red as scan |

## How to build a ninth

1. Start from the brand's own primary colour for `line`. The strokes are the
   mark; they should feel like the brand, not like a filter.
2. Pick `bg` so that `line` has at least 3:1 contrast. A mid-tone background with
   a mid-tone line is the fastest way to an unreadable card.
3. Pick `scan` in a hue **outside** the line's hue family. The detection boxes
   are annotations; if they share the mark's colour they disappear into it.
4. `scanInk` is either near-white or near-black — pick whichever contrasts with
   `scan`. Do not pick a tinted colour here.
5. `glow` is the same hue as `bg`, at low alpha. It should be felt, not seen.
6. `edge` is `bg`-relative: on light cards use black at 0.17, on dark cards use
   white at 0.16–0.24.

## Card ordering

Order carries meaning. The shipped page runs Apple → Google → Tesla (the three
originals, all light-to-dark rhythm), then DeepSeek → Xiaomi → Huawei →
ByteDance → TikTok as the China batch. Alternating light and dark backgrounds
across a row keeps the grid from reading as a solid block; if you add a brand,
check the row's tonal rhythm rather than its alphabetical position.
