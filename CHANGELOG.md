# KoralPaper — Changelog

## v3.5.0 — 2026-08-02
- **Fixed: fonts now apply on first selection.** Google font files load
  lazily and canvas drawing doesn't trigger the download, so a freshly
  picked font painted with a fallback until re-selected. The app now
  requests the font file explicitly on selection (and for every font a
  document uses), and repaints automatically the moment a font arrives.
- **Text sizes are customizable**: Settings gained four sliders for the
  S / M / L / XL text presets (defaults 16 / 21 / 29 / 42), working exactly
  like the width presets — live, persistent, and included in "Reset to
  defaults".
- Imbue moved to the Serif group in the font picker.

## v3.4.0 — 2026-08-02
- **Pin your icons**: right-click any Google Material icon in the picker to
  pin it (★). Pinned icons always lead the default grid — ahead of recents
  and the popular set — and the grid grows up to 18 slots as you pin more.
  Right-click again to unpin.
- **21 new Google Fonts**, organized into groups in the font picker
  (Sans & display / Serif / Mono / Hand & script / Pixel & dot):
  Inter, Montserrat, Roboto Condensed, Bebas Neue, Fjalla One, Oswald,
  Imbue · Playfair Display, PT Serif · Share Tech Mono · Lobster Two,
  Playwrite NZ Guides, Unkempt, Kaushan Script · Bitcount Prop Single,
  Bitcount Single, Bitcount Prop Double Ink, Tiny5, Doto — alongside the
  existing library. (Two names from the request corrected to their
  official Google Fonts names: "Playwrite New Zealand Guides" → Playwrite
  NZ Guides, "Dotto" → Doto.)

## v3.3.0 — 2026-08-02
- **Google Material icons**: the icon menu (✳) now includes Google's
  Material Symbols library — the 9 most popular icons by default, a search
  field over 3,000 icons (names *and* tags: try "money", "arrow", "idea"),
  and a **Recently used** row that replaces the defaults as you work.
  Click an icon and stamp it like any other. Icons take your stroke color,
  scale as vectors, and export perfectly to SVG/PNG/PDF. Each icon is
  fetched from Google once (internet needed that first time), then cached —
  and the vector path is stored inside your document, so saved sketches
  render fully offline forever. Enter in the search field picks the first
  result.

## v3.2.0 — 2026-08-02
- **Settings panel**: the ? button now opens a side panel with two tabs —
  Help (the shortcuts card) and **Settings**. Settings holds three sliders
  for the Fine / Medium / Thick line-width presets: they update the style
  panel buttons and the default width live, and persist in the browser.
  "Reset to defaults" restores the standard values.
- **New width defaults**: Fine 1.7, Medium 3.3, Thick 5 (softening the
  brief 2/4/6 of v3.1.0). Documents saved under either older scale migrate
  automatically on open.

## v3.1.0 — 2026-08-02
- **Bolder line widths**: all three stroke-width stages moved one step up —
  Fine 1.2→2, Medium 2→4, Thick 4→6 — so lines are clearly distinguishable
  at a glance. The default width is the new Medium (4). Existing sketches
  migrate automatically on open (each preset value maps to its new stage);
  the demo scene and built-in templates use the new widths, and the
  Excalidraw import/export width mapping follows the new scale.

## v3.0.1 — 2026-08-02
- **Help card 2.0**: reorganized into sections (Tools, Editing, Files &
  view, Arrows, Images & art styles, More) and audited against the real
  keyboard handler — previously undocumented shortcuts are now listed
  (⌘S save, ⌘O open, ⌘X cut, ⇧1 zoom to fit, arrow-key nudge, Esc), plus
  new sections covering elbow arrows, image import with all 11 art styles
  and the photo adjustment sliders, crop, the context menu, pages,
  templates, and canvas sizes. Clicking anywhere outside the card now
  dismisses it. First release published to GitHub under the MIT license.

## v3.0.0 — 2026-08-02
- **The app is now KoralPaper** — *Draw your thinking.* New identity
  everywhere: the "paper thought" brand mark (wobbly page + coral asterisk
  + thought dots) in the brand row and favicon, the motto under the title,
  new window title, and all export filenames now start with `koralpaper-`.
  The help card (?) credits the creator: Stefanos Karagos, CAIO Group —
  wearecaio.com. Saved documents, templates, and settings carry over
  untouched.
- **Icon library**: the asterisk stamp is redrawn as the 6-spoke KoralPaper
  asterisk (rounded bar + two diagonals), and three brand marks join the
  gallery — *asterisk on paper*, *paper & stroke*, and *paper thought*.
  All are two-tone: page in your stroke color, mark in your fill color.
- Previously the app was called "Asterisk" (v1.0–v2.15.1, changelog below).

## v2.15.1 — 2026-07-27
- **Fixed: segment handles missing on simple elbows.** Handles only
  appeared on middle segments, so L-shaped (and other short) elbow routes
  showed none at all. Now **every segment has a handle**; dragging a
  segment that touches an endpoint splits off a small connector stub so
  the endpoint stays glued while the segment slides — Excalidraw behavior.

## v2.15.0 — 2026-07-27
- **Elbow arrows 2.0 — avoidance + segment editing** (v2.14.0 kept as a
  backup in `asterisk-sketch-backups/`):
  - **Obstacle avoidance**: auto-routed elbows now steer around other
    shapes. Simple routes are tried first; when they'd cross a shape, an
    A* router walks the gaps between shapes (with a clearance margin and
    a bend penalty, so routes stay short and calm).
  - **A handle on every segment**: selecting an elbow shows one draggable
    dot per segment, Excalidraw-style. Drag any of them to slide that
    segment; the route becomes fully editable corner-by-corner and stays
    orthogonal. Endpoints keep re-gluing as shapes move — the corner next
    to each end follows automatically.
  - Right-click a customized elbow → **"Re-route elbow (auto)"** to hand
    it back to the automatic router. Picking any bend style from the
    panel also resets the custom corners.
  - Excalidraw round-trip upgraded: our edited corners export as real
    points, and imported elbow arrows keep their bends as editable
    corners instead of being re-routed.

## v2.14.0 — 2026-07-27
- **Elbow arrows** (Excalidraw-style): a fourth option in the "Arrow bend"
  row routes arrows and lines with clean right angles and softly rounded
  corners. Glued elbows exit perpendicular to the side they're pinned to
  (the N/E/S/W anchor dots), re-route live as shapes move, and when the
  route has a middle segment you can **drag the midpoint handle** to slide
  the bend — just like the reference. Labels ride the elbow path, arrowheads
  align with the final segment, SVG/PNG/PDF exports match, and the style
  round-trips to Excalidraw (`elbowed`).

## v2.13.0 — 2026-07-27
- **Paper color popover**: the paper swatch (top right) now opens a proper
  popover instead of the bare system picker — 8 preset papers (theme cream,
  white, light gray, light blue, soft green, soft yellow, soft mauve, warm
  linen), a full color wheel, and a **hex field** like the stroke/fill
  pickers. The active paper is highlighted; the "Theme paper" swatch
  follows light/dark mode and doubles as a reset.

## v2.12.4 — 2026-07-27
- **Zoom follows the selection**: with an element (or several) selected,
  the + / − zoom buttons and the 100% reset zoom toward the selection's
  center instead of the middle of the screen — so the thing you're working
  on stays put while everything scales around it. With nothing selected
  the behavior is unchanged.

## v2.12.3 — 2026-07-27
- **Clearer canvas-size button**: the bottom-left button that opens the
  canvas presets now shows a small artboard icon, so it reads as "canvas
  size" at a glance instead of a bare ∞. The dimensions of the selected
  preset (e.g. 1080×1350) sit right next to the icon; with an unlimited
  canvas it shows ∞.

## v2.12.2 — 2026-07-27
- **Fixed startup**: the app now always opens your latest autosaved
  document, and a genuinely fresh start is a blank document. Previously
  a first run — and, worse, a saved document consisting of one empty page
  (exactly what New document leaves behind) — was silently replaced by
  the demo sketch on reload. The demo is still available on demand via
  ☰ → "Load the demo sketch".

## v2.12.1 — 2026-07-27
- **Named saves**: "Save sketch (.json)" now asks for a file name (instead
  of always using `asterisk-sketch-<date>`). The name is remembered as the
  default for the next save; opening a .json adopts that file's name, and
  New document resets it. Illegal filename characters are cleaned up and
  `.json` is added automatically.

## v2.12.0 — 2026-07-27
- **New document**: ☰ → New document (or ⌥⌘N) starts a fresh, empty
  document — one blank page, artboard and paper color reset, zoom back to
  100%. If the current document has content it asks first, reminding you
  to Save a .json copy; ⌘Z still brings the previous pages back.
- Clarified: "Open sketch (.json)" replaces the whole document (open a
  saved document), while opening a .excalidraw file imports it as a new
  page into the current document.

## v2.11.0 — 2026-07-26
- **Templates**: ☰ → Templates… opens a library of ready-made pages. Four
  built-ins ship with the app:
  - *LinkedIn carousel* — 5 slides on a 1080×1350 artboard: cover (header
    chip, big two-line serif title, subtitle, coral "swipe" arrow), two
    content slides (numbered chip, heading, two body texts, butter takeaway
    sticky), a photo slide with a drop-your-image placeholder, and a CTA
    slide — CAIO header chip and Stefanos-Karagos footer + asterisk on
    every slide.
  - *Flowchart kit* — start chip, steps, decision diamond, labeled glued
    arrows (including a "retry" back-link).
  - *Comparison / Versus* — two hachure columns with pros/cons and a
    rotated verdict sticky.
  - *Quote card* — 1080×1080 square with a big serif quote and the coral
    asterisk.
- **Save your own templates**: "Save current page…" stores the active page
  (plus its artboard) in the browser's local template library; user
  templates appear in the dialog with a ✕ to delete. Applying any template
  appends fresh pages (new ids — apply twice safely), sets the artboard,
  and jumps to the first new page. Everything stays fully editable.

## v2.10.0 — 2026-07-26
- **Copy / paste style**: ⌥⌘C copies the first-selected element's style
  (stroke color/width/dash/sketchiness, fill + fill style, corners, opacity,
  font/size/align); ⌥⌘V pastes it onto everything selected. Also in the
  right-click menu ("Copy style" / "Paste style").
- **Match size**: two new Arrange buttons equalize width and/or height across
  selected shapes — the first-selected element sets the size, others resize
  around their own centers (arrows and text are excluded; glued arrows
  re-attach automatically).

## v2.9.1 — 2026-07-26
- **Arrowhead styles**: each end of an arrow or line picks its own head from
  dropdowns — none, open arrow, hollow triangle, or circle ring. Hollow
  heads fill with the paper color so the line ends cleanly. Old sketches
  migrate (booleans → named heads); Excalidraw maps triangle↔triangle and
  circle↔dot in both directions.
- Note: straight-arrow label centering was fixed in v2.9.0 — hard-refresh
  (⌘⇧R) if an open copy still shows labels at the endpoint.

## v2.9.0 — 2026-07-26
- **Arrow & line labels**: double-click any arrow or line (or press Enter
  with it selected) to type a label. It rides the midpoint on a small paper
  pill, follows every move, bend, and re-anchor automatically, uses the
  arrow's stroke color and the font controls, and exports to PNG/SVG/PDF.
  Fixed alongside: midpoints of straight two-point lines were computed at
  the endpoint (also affected the curve handle).
- **Excalidraw interop**: ☰ → "Export page to Excalidraw" writes a
  .excalidraw file (shapes, arrows with bound labels, freedraw, text,
  images with embedded files; theme tokens resolve to hex; icons/art styles
  skipped with a note). Opening a .excalidraw via ☰ → Open imports it onto
  a new page (hex colors become custom colors, bound labels merge into
  their shapes, groups survive). Round-trip verified lossless for the
  supported set.

## v2.8.2 — 2026-07-26
- **String threads now show your true color**: opacity raised to 82% (from
  58%), so a coral thread reads coral and ink reads black — tone comes from
  coverage density like real opaque thread. The crossing-toll was raised to
  keep highlights open.

## v2.8.1 — 2026-07-26
- **String contrast**: darker blacks — ~40% more chords (1600/2700/4300),
  bigger ink budget in dark cells, thread opacity 0.58. Highlights stay
  protected by the per-crossing toll.
- **Crop cursor fixed**: entering crop mode now shows a dedicated coral
  crop-frame cursor that persists (a hover handler used to overwrite it with
  the default arrows), plus a clearer "✂ Crop mode" hint.

## v2.8.0 — 2026-07-26
Three new algorithmic art styles (13 total):
- **String** — one thread wound around a ring of pins; each chord is chosen
  greedily to cross the most unpaid darkness (with a per-crossing toll that
  protects highlights); threads render semi-transparent so crossings darken
  like real string. Vector `<line>` output.
- **Type** — typewriter portrait: a monospace glyph per cell chosen from a
  density ramp (JetBrains Mono), light cells left blank. Vector `<text>`.
- **Duotone** — two-ink print poster: cells posterize into shadow (stroke
  color) and midtone (fill color) runs; levels resolve at draw time so the
  poster re-inks with palette and theme. The Fill row appears for duotone
  images. Vector `<rect>` runs.

## v2.7.1 — 2026-07-26
- One line refinements: chain connectors are now **Hermite curves** that
  leave each contour along its own tangent and arrive along the next one's —
  swooping pen travel, no straight segments or sharp junction angles.
  Rounder chain smoothing (coarser subsampling + 3 passes). **Fine** admits
  weaker edges and keeps up to 30 chains (was 20) for visibly richer
  portraits; Coarse/Medium slightly up (8/14).

## v2.7.0 — 2026-07-26
- **One line — complete redesign** on the Edge Drawing (ED) algorithm family:
  blur → Sobel gradient magnitude/orientation → anchor points (gradient
  maxima) → edge-walking that always steps to the strongest neighboring edge
  pixel → long, clean contour chains → keep the most salient (7/12/20 by
  detail) → smooth, simplify, and greedily connect nearest endpoints into a
  SINGLE continuous traveling line. Portraits now render as genuine one-line
  drawings: hair sweep, glasses, jaw, beard as connected contours on empty
  paper. Flow is unchanged (the previous hybrid was reverted).

## v2.6.1 — 2026-07-26
- Tuned Scribble and One line against a real studio portrait:
  - Scribble: midtones earn more ink (gamma 1.35 → 1.2, K 5.5 → 6.0), so
    cheek and nose shading gets modeled instead of only silhouettes.
  - One line: fewer seeds (80/150/260), much longer strokes, a wider-tap
    (calmer) direction field, and short fragments dropped — closer to the
    clean single-line reference.

## v2.6.0 — 2026-07-26
- **New art style: Scribble** — a restless constant-width pen line that
  builds tone purely from loop density (Vince Low style). Every coverage
  cell "owes" ink proportional to its darkness (+ edge bonus); the walker
  steps toward the largest residual debt with turns penalized by local
  brightness — tight chaotic curls in shadows, calm arcs through highlights.
  The pen keeps drawing until the whole image's ink debt is paid, so small
  features (eyes, mouths) are never skipped. A handful of very long
  continuous lines; pure vector in SVG.
- **New art style: One line** — the minimal pole of the same art form: a few
  long constant-width lines tracing only the strongest contours (edge-seeded
  streamlines, no shading). Glasses, hairlines, and jawlines emerge from
  almost nothing.

## v2.5.0 — 2026-07-26
- **New art style: Flow** — thousands of short ink strokes that trace along
  the photo's contour field (the 90°-rotated luminance gradient). Features
  are drawn as wrapping contour lines, flat dark areas fill with scribble
  shading, stroke width and density follow tone. Looks like a hand-drawn
  pen portrait; fully vector in SVG; seeded like everything else.
- **Cubist (both variants)**: Coarse 10→14 and Medium 16→22 columns, so the
  subject reads more easily at every level (Fine unchanged at 34).

## v2.4.0 — 2026-07-26
- **Cubist mono**: a seventh art style — the same faceted mesh rendered as
  shades of your stroke color (via per-facet opacity), so it behaves like the
  other monochrome styles and re-tints when you change stroke or theme.
  Color Cubist stays as-is.
- **Fine detail level is now genuinely fine** (Coarse/Medium unchanged):
  halftone 72 cols, lines 110 rows, stipple 12 000 points, hatch 66 cols,
  cubist 34 cols — clear step up in resolved detail.

## v2.3.0 — 2026-07-26
- **Photo adjustments**: Brightness, Contrast, Gamma, and Sharpen sliders on
  every image (panel, with live preview and a Reset button). Adjustments feed
  both the Photo display and the art styles — the tonal analysis and edge map
  are recomputed on the adjusted pixels, so a sharpened, contrast-boosted
  source makes noticeably crisper algorithmic art. Saved in .json.
- **Lines**: rows ~30% tighter again (40/60/84) with finer sampling — facial
  detail now resolves clearly.
- **Stipple**: ~75% more points (2600/5200/9000), density saturates in true
  darks (solid mass instead of grain), finer dot size — silhouettes read
  immediately.

## v2.2.1 — 2026-07-26
- **Lines & Stipple tuned for real photos** (dark backgrounds used to drown
  the subject):
  - Both styles now auto contrast-stretch tones (3–97% luminance percentiles),
    so any photo uses the full quiet-to-busy range.
  - Lines: tighter row spacing (30/46/64 rows) with a tone gamma — light
    subjects run as calm bands against churning dark fields.
  - Stipple: ~60% more points, finer grain, and a Sobel edge map added to the
    dot placement so contours (glasses, jawlines, hairlines) stay readable
    regardless of tone.
  - Dots/halftone untouched, as requested.

## v2.2.0 — 2026-07-26
- **Crop**: select an image → Crop (panel or right-click) → drag across the
  region to keep. Works before and after Artify (the crop is a window into
  the source, so the art styles re-flow to the cropped area), survives style
  switches, and Uncrop restores the full image. Cropped photos export
  correctly to PNG, SVG (clipped), and PDF.
- **Fix**: moving an artified image only moved its selection outline — the
  art primitives were cached at absolute canvas positions. They're now
  generated in element-local space, which also makes dragging images free
  (no regeneration).

## v2.1.0 — 2026-07-26
- **Image import**: drag & drop PNG/JPEG onto the canvas, paste from the
  clipboard, or ☰ → Import image. Images are downscaled to ≤1024px for sane
  file sizes, become normal elements (move/resize/rotate, arrows glue to
  them), and are saved inside .json files.
- **Algorithmic art (Artify)**: select an image and pick an Art style —
  **Photo, Dots (halftone), Lines (engraving), Stipple, Hatch, Cubist**
  (low-poly facets that keep the photo's colors) — with Coarse/Medium/Fine
  detail. Non-destructive: switch styles or return to Photo anytime. Mono
  styles follow the stroke color. SVG export stays pure vector
  (circles/lines/polygons — no embedded bitmap).
- Copy/paste got smarter: system-clipboard images paste as elements; internal
  element copies still win when they're the freshest thing copied.

## v2.0.0 — 2026-07-26
- **Multi-page documents**: page strip at the bottom (click to switch, + to add;
  right-click a tab for rename / duplicate / move / delete). Undo/redo spans
  the whole document, so page operations are undoable.
- **PDF export**: ☰ or ⬇ menu → Export PDF. Multi-page sketches open a page
  picker; artboard sketches export at exact artboard size with the grid.
  Zero dependencies — the PDF is written by hand (JPEG pages, DCTDecode).
- Save format v3 (`pages` array); older .json files and autosaves migrate
  automatically. Saved files now record the app version.
- Version shown at the bottom of the ☰ menu.
- Fix: text editor no longer drifts away from its shape when panning or
  zooming while typing.

## v1.4 — 2026-07-26
- Adjustable grid size (10–60 px) with Lines / Dots / Off popover.
- Align left/center/right/top/middle/bottom + distribute (groups move as units,
  arrows excluded and re-glue).
- Light / medium / dark grey stroke & fill tokens.
- Fill styles: dense lines, cross-hatch, dots, waves (shapes and icons; SVG too).
- Right-click context menu (elements + empty canvas).

## v1.3 — 2026-07-26
- Artboards / canvas size presets (social, wallpapers, ratios) with
  grid-included exports at exact pixel sizes.
- Hex field in the custom color popover.
- Group/Ungroup buttons.
- Fix: seam corner on sloppy closed shapes; fills now hug sketchy outlines.

## v1.2 — 2026-07-26
- Curve handle on arrows/lines (drag the middle to bend).
- Grid tri-state (lines / dots / off), custom paper color.
- Dotted & dashed line styles; lighter thin stroke; stroke "none".
- Asterisk redesigned as rounded capsule rays (fill + stroke like any shape).
- ⬇ export menu in the top-right.

## v1.1 — 2026-07-26
- Icon library (asterisk, spiral, cloud, star, heart, bolt, bubble, !, ?, ✓).
- Arrow anchor pins (N/E/S/W side dots).
- SVG export (± background), Google Fonts picker, custom colors.

## v1.0 — 2026-07-26
- Initial release: Claude-carousel aesthetic, sticky notes, chips, glued
  arrows, hand-drawn rendering, grid & snapping, undo/redo, groups,
  light/dark paper, PNG export, autosave.
