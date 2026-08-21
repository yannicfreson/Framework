# Instagram post generator — design

**Date:** 2026-08-21
**Route:** `/post-generator`
**Status:** approved in brainstorming, not yet implemented

## Purpose

An internal tool that composes a finished Instagram post — Framework's block artwork
plus text, set in the studio's own type — and exports it at all three sizes Instagram
uses. A post is done when it leaves the tool; nothing is finished elsewhere.

It is templated, not freeform. Everything it can produce is on-brand by construction,
which is the point: five people posting from one tool should not produce five visual
languages.

## Scope

In scope:

- Four fixed layouts, text fields, artwork selection, paper/ink theme.
- Live preview at all three ratios simultaneously.
- Export of three PNGs (1:1, 4:5, 9:16) in one action.
- Draft persistence in the browser, plus a shareable URL that encodes the whole post.

Explicitly out of scope for this build:

- Authentication (see "Login" below).
- A library of saved posts.
- Multi-slide carousels.
- Uploading custom images.
- Any colour beyond the existing paper and ink themes.
- Animated or video export.

## The document model

One plain object describes a post completely. It is the draft in `localStorage`, the
payload in the share URL, and the only input to rendering. No other state exists.

```js
{
  v: 1,                                   // schema version
  layout: 'headline-above',               // headline-above | split | art-full | statement
  theme: 'paper',                         // paper | ink
  eyebrow: 'Framework · How we work',     // max 60 chars
  headline: 'Four weeks to something real.', // max 120 chars
  footer: 'framework.studio',             // max 60 chars
  art: {
    composition: 'stack',                 // stack | row | tower | gate | random
    seed: null                            // integer, required when composition is 'random'
  },
  preview: '4:5'                          // 1:1 | 4:5 | 9:16 — which one is enlarged
}
```

Defaults: `headline-above`, `paper`, eyebrow `Framework`, headline empty, footer
`framework.studio`, art `stack`, preview `4:5`. The `statement` layout ignores `art`.

Two things about `art` that are easy to get wrong:

- `random` is **not** in `FrameworkBlocks.compositions` — that array lists only the four
  named compositions. The picker must add `random` itself.
- When `random` is selected the UI assigns a concrete integer seed immediately and stores
  it. A seed of `null` would make `blocks.js` fall back to seed `1`, so a shared "random"
  post would silently reproduce as a different sculpture for the recipient than the one
  the author saw. `normalise` therefore fills a missing seed rather than leaving it null.

`v` exists so a share URL made today can be recognised or rejected by a later version
rather than silently misread.

## Modules

```
post-generator.html        the page; served at /post-generator by cleanUrls
assets/post/layouts.js     pure — document + canvas size → draw ops. No canvas, no DOM.
assets/post/render.js      draw ops + canvas → pixels. Owns all drawing.
assets/post/state.js       defaults, validation, localStorage, URL encode/decode
assets/post/app.js         form wiring, preview loop, export
assets/post/post.css       editor chrome — not the post itself
```

`layouts.js` and `state.js` use the same UMD wrapper as `blocks.js`, so they load
unchanged in Node and in the browser. That is what makes them testable without a DOM.

Existing modules are reused as-is: `assets/blocks.js` for geometry and the flat hatched
SVG, `assets/blocks3d.js` for the rendered artwork. Neither is modified by this work.

### layouts.js

```js
layout(doc, { width, height }, measure) -> { ops, warnings }
```

`measure(text, font) -> width` is passed in rather than imported. In the browser it is a
canvas `measureText`; in tests it is a deterministic stub. This is what lets the module
stay pure while still breaking lines correctly — line breaking needs text metrics, and
metrics need a canvas, so the dependency is inverted instead of embedded.

Ops are the interface to `render.js`. Positions are device pixels for the given size:

```js
{ type: 'fill', x, y, w, h, colour }
{ type: 'rule', x, y, w, thickness, colour }
{ type: 'text', x, y, lines, font, colour, align }   // y = baseline of first line
{ type: 'art',  x, y, w, h, composition, seed, theme }
```

Warnings are structured, not strings:

```js
{ kind: 'shrunk' | 'clipped', field: 'headline', steps: 2 }
```

### render.js

```js
paint(canvas, ops, cache) -> Promise<void>
```

Walks the ops and draws them. Owns the artwork cache, keyed by
`composition|seed|theme|width|height`, so typing a headline never re-runs WebGL.

Artwork comes from `blocks3d.createSculpture()` when WebGL is available and from the
`blocks.js` hatched SVG through an `Image` when it is not. Both produce the same
engraving, so the fallback is a quality difference of degree, not of look.

### state.js

```js
defaults() -> doc
normalise(raw) -> doc          // clamps lengths, whitelists enums, never throws
encode(doc) -> string          // base64url of compact JSON with short keys
decode(string) -> doc | null
save(doc) / load() -> doc|null // localStorage, try/catch
MAX_URL_CHARS = 1800
```

`normalise` is the only way a document enters the system — from defaults, from
`localStorage`, or from a URL. Hostile or truncated input becomes a valid default
document rather than an exception.

## Layouts

Each is drawn from something already on the site rather than invented for this tool.

| Layout | Composition |
|---|---|
| `headline-above` | Mono eyebrow, Jost headline, artwork filling the remaining height. The default. |
| `split` | The site's hero — type one side, sculpture in a striped panel the other. Stacks vertically at 9:16. |
| `art-full` | Sculpture bleeds the full frame; headline on a hard ink bar across it, like the work-tile hover. |
| `statement` | Type only, no artwork. Large headline with hairline rules. For quotes and announcements. |

Layouts are functions, not templates with baked positions. Compose-once-export-three
means 1:1 and 9:16 need genuinely different proportions, not a stretched copy of one
another.

### The unit scale

One unit = `width / 1080`. Every size and margin in a layout is expressed in units, so:

- a 1:1 and a 9:16 post have the same optical type size;
- a 2× export is exactly 2× everything, with no rounding drift.

At 1080 wide: margin 72u; eyebrow 22u mono, tracking 0.18em, uppercase; headline steps
`[96, 84, 72, 62]` Jost 400, line-height 1.03; footer 20u mono, tracking 0.12em,
uppercase. Colours come from the existing tokens — ink `#16171A`, paper `#F5F4F1`,
muted `#6B6B64`.

### Overflow

A headline that does not fit shrinks one step at a time through the scale, up to three
steps. If it still does not fit it wraps, and if it still does not fit it is clipped and
a `clipped` warning is raised. Clipping is never silent: a headline can sit comfortably
at 1:1 and overflow at 9:16, and the tool exports both.

## Editor

Two columns: controls left, previews right; stacked on narrow screens. Styled from the
existing tokens in `styles.css` so the tool looks like the studio that made it.

**All three ratios are on screen at once** — the `preview` ratio enlarged, the other two
live beside it. This is the load-bearing decision of the tool. You are exporting three
files, so you have to *see* that the headline breaks at 9:16 before you post, not after.
The structured warnings are the backup, not the mechanism.

**The preview is the export.** The preview canvas's backing store is the real export
bitmap at 1080 wide, CSS-scaled to fit. There is no second code path and no smaller
approximation, so preview and export cannot drift.

Repaints are debounced at 120ms. Inputs are labelled, focus is visible, and each preview
canvas carries an `aria-label` describing the post it shows.

## Export

Walks the three ratios sequentially — one shared WebGL context means they cannot run in
parallel — rendering each through the same layout and paint path:

| Ratio | Pixels |
|---|---|
| 1:1 | 1080 × 1080 |
| 4:5 | 1080 × 1350 |
| 9:16 | 1080 × 1920 |

Each is downloaded via an object URL and an `<a download>`, revoked after. Filenames slug
from the headline: `framework-four-weeks-to-something-real-4x5.png`, falling back to the
date when the headline is empty.

## Failure behaviour

| Case | Behaviour |
|---|---|
| No WebGL | Artwork falls back to the hatched SVG from `blocks.js` via an `Image`. |
| Fonts not loaded | Export is disabled until `document.fonts.load()` resolves for Jost 400 and IBM Plex Mono 400. Without this an export silently ships in Helvetica — the worst bug this tool can have, because it is invisible until the post is public. |
| Encoded state over 1800 chars | Copy-link explains it is too long rather than handing over a truncated URL. |
| Malformed or truncated share URL | `normalise` returns a default document. Never throws. |
| `localStorage` blocked | The tool works; no draft restore. All access wrapped in try/catch. |
| Headline clipped at some ratio | Warning surfaced against that ratio's thumbnail. Export is not blocked — it is the user's call. |

## Testing

`node --test`, built into the installed Node 20.18. No new dependency.

`test/layouts.test.js`:

- every layout at all three ratios produces ops that stay inside the frame — the reflow
  contract, asserted directly;
- doubling canvas width doubles every type size and margin exactly;
- a 200-character headline shrinks, then reports `clipped` rather than overflowing;
- `statement` emits no `art` op.

`test/state.test.js`:

- `encode` → `decode` round-trips every field;
- truncated, malformed and hostile input returns a default document and never throws;
- over-length text is clamped by `normalise`, not silently stored;
- oversize documents are reported against `MAX_URL_CHARS`.

`render.js` and `app.js` are verified in the browser with screenshots and pixel probes —
the approach that caught the mirrored axis mapping, the missing shadow-camera transform
and the shared-WebGL-context limit during the block art work.

Tests for the two pure modules are written before their implementations.

## Login

No auth abstraction is built now. A seam invented before the requirement usually fits it
badly, and there is a more important point to record:

**On a static site, client-side auth is not a security boundary.** The page and its
JavaScript are public regardless of what a login form does. When `/post-generator` needs
protecting it must be enforced at the edge — Vercel Deployment Protection on the path is
a configuration change and needs no code. Per-user accounts are a real backend decision
and should not be pre-empted with scaffolding.

What this build does instead:

- `/post-generator` is standalone — its own HTML and CSS, importing only `blocks.js` and
  `blocks3d.js`. Nothing on the marketing site links to it.
- `noindex` on the page.
- A `robots.txt` disallowing `/post-generator` and `/blocks`. There is none today.

## Decisions and their reasons

| Decision | Why |
|---|---|
| Canvas 2D, not DOM rasterisation | Preview and export share one draw path, so they cannot diverge. DOM rasterisers reimplement CSS approximately and fail hardest on web fonts and tracking. |
| `measure` injected into `layouts.js` | Line breaking needs text metrics; metrics need a canvas. Inverting the dependency keeps the module pure and testable. |
| Layouts as functions | Fixed pixel templates cannot reflow across 1:1 → 9:16. |
| Type scale keyed to width | Same optical size across ratios; exact integer scaling on export. |
| Artwork cached by key | Typing must not re-run WebGL. |
| Three ratios always visible | The tool ships three files; overflow must be visible before posting. |
| No auth scaffolding | Client-side auth on a static page protects nothing; edge protection is a config change when needed. |
