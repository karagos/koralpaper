# KoralPaper — Changelog

## v3.29.0 — 2026-08-04
- **Autosave failure is loud now.** When the document outgrows the
  browser's storage, autosave used to fail silently — a reload would
  lose work the user believed was saved. Now an amber banner appears
  ("Autosave is off… your work lives only in this tab") with a one-click
  "Save now (.json)" button, and disappears by itself the moment
  autosave succeeds again. Settings additionally shows the current
  document size next to the ~5 MB autosave ceiling, and flags a failing
  autosave there too.
- **Second-tab guard.** Opening KoralPaper in two tabs at once quietly
  corrupted autosave (each tab overwrites the other) and split Claude's
  commands between tabs. Every living tab now leaves a heartbeat in
  storage; when a tab sees a fresh heartbeat that is not its own, it
  shows a clear warning. Works even when the browser throttles or
  freezes the other tab, and a plain reload never false-alarms.

## v3.28.0 — 2026-08-04
- **KoralPaper is live on the web.** The repo now serves the app at
  https://karagos.github.io/koralpaper/ — open the link and draw, on any
  OS including iPad. Nothing about privacy changes: the page is static,
  your work stays in your browser.
- **Installable app (PWA).** A web manifest, app icons and a service
  worker make the page installable (Chrome/Edge: install icon; iPad:
  Add to Home Screen) and fully offline after the first visit. Updates
  arrive automatically when online (network-first, cache fallback).
- **Real installation docs + first GitHub Release.** The README now has
  a proper install section (web app / local folder / Claude extension),
  and Releases carry a ready-to-use ZIP plus the koralpaper.mcpb.

## v3.27.0 — 2026-08-04
- **Text color, independent of the outline.** A new "Text" row in the
  style panel colors the text of shapes, labels and text elements
  separately from the stroke: **A** = Auto (the default — follows the
  stroke, and now automatically flips to a light cream on ANY dark
  fill, custom hex included, not just black), the full palette, or a
  custom hex. Dark card + black outline + white text finally works.
  Carried everywhere: canvas, live editing caret, SVG/PNG/PDF exports,
  copy/paste style, and the Claude tools (Claude can set "textColor"
  and sees it when reading the page; the design prompt teaches it too).

## v3.26.3 — 2026-08-04
- **Fixed for real: ⇧-drag with Shift already held.** The natural
  gesture — shift-click to build a selection, keep Shift down, drag —
  never started a drag at all: the press was consumed as another
  shift-click toggle. Now a ⇧-press on an already-selected element
  starts the axis-locked move of the whole selection, and only counts
  as a deselect-click if the mouse releases without moving (the Figma
  behavior). Shift-clicking to add and remove elements works exactly
  as before.

## v3.26.2 — 2026-08-04
- **Fixed: ⇧-drag axis lock.** Holding Shift while dragging a selection
  is supposed to lock the move to the horizontal or vertical axis, but
  grid and alignment snapping ran afterwards and nudged the frozen axis
  onto the nearest line — visible especially with multi-selections,
  which are rarely grid-aligned. The lock is now re-asserted after
  snapping, so a ⇧-drag stays perfectly straight while the free axis
  still snaps. Also documented in the Help card.

## v3.26.1 — 2026-08-04
- **Bridge 1.1.0: every Claude app works at once.** The connector can be
  installed in Claude Desktop, Claude Code and Cowork at the same time.
  Previously only the first instance to claim the local port could reach
  the paper; the rest silently reported "not linked". Now any instance
  that finds the port busy runs as a proxy, forwarding its tool calls to
  the primary — and if the primary quits, the proxy takes over the port.
  Update by double-clicking the rebuilt `mcp/koralpaper.mcpb` and
  restarting your Claude apps.

## v3.26.0 — 2026-08-04
- **Design with Claude.** KoralPaper now ships an MCP extension for the
  free Claude Desktop app: double-click `mcp/koralpaper.mcpb` to install
  (no API key, no terminal, no extra billing), keep KoralPaper open in
  the browser, and describe what you want in Claude Desktop. Claude
  draws live on your paper — pages, glued flowcharts, labeled arrows,
  artboards, colors — as ordinary editable elements, one undo step per
  Claude action. Seven tools: status, read the document, create a page,
  add / update / delete elements, and **render the page as an image so
  Claude checks its own layout with its own eyes** before saying done.
  A pulsing ✳ appears in the top bar while the link is alive.
- **Claude tab.** The ? panel grew a third tab with the live link
  status, the one-minute setup, example prompts — and the no-Desktop
  fallback: "Copy the design prompt" teaches any Claude (claude.ai
  included) the KoralPaper file format; save its .json answer and open
  it with ☰ → Open sketch.
- Under the hood: the bridge is one dependency-free Node file speaking
  MCP over stdio plus a localhost long-poll the app listens to; every
  element Claude sends is validated and normalized before it touches
  the paper.

## v3.25.0 — 2026-08-03
- **Share as a web page.** ☰ / ⬇ → "Share as web page (.html)": the
  whole document becomes ONE self-contained HTML file — every page an
  inline vector SVG (images embedded as data URLs, Google fonts arrive
  via each SVG's own import when online, system fallbacks offline) plus
  a tiny built-in dark viewer: page navigation buttons, keyboard arrows,
  page names, and a "Made with KoralPaper" credit linking to
  wearecaio.com and the repository. No app, no server, no account
  needed to view it — double-click and present.

## v3.24.0 — 2026-08-03
- **Tab-to-create.** Select a shape, press Tab: a connected twin appears
  to the right (⇧Tab: below) — same type, same style, glued arrow with
  your default arrowheads, text editor already open. Tab also works
  while typing inside a shape, so "type, Tab, type, Tab" builds a whole
  flowchart without touching the mouse. New shapes dodge whatever is
  already on the canvas.
- **Tidy.** The new Arrange button (or right-click → "Tidy the flow")
  lays out every shape connected by glued arrows as a clean
  left-to-right layered graph: columns by flow depth, rows centered,
  arrows re-aimed east-to-west, elbow routes recalculated. Standalone
  elements never move. Works on the selection (2+) or the whole page.

## v3.23.0 — 2026-08-03
- **Draw-on replay.** ☰ → "Replay the drawing": the current page redraws
  itself as if a hand were sketching it — freehand strokes reveal point
  by point, arrows sweep out from their start (works for straight,
  curved and elbow routes), shapes and text ink in with a soft settle,
  elements overlapping slightly in sequence. Long pages compress so the
  whole show stays under ~20 seconds; any click or key cancels.
- **Animated export.** ☰ → "Export replay as video (.webm)" records the
  replay to a video file via the browser's own MediaRecorder — still
  zero dependencies. Named after your document, saved automatically
  when the animation completes.

## v3.22.0 — 2026-08-03
- **Presentation mode + laser pen.** ⇧⌘P or ☰ → Present: all chrome
  disappears, the page fits the screen (fullscreen when the browser
  allows it), and the document becomes a slide show — arrow keys, space,
  or a click turn pages. Dragging the mouse draws a glowing coral laser
  stroke whose tail evaporates after a second, so you can point at
  things live without ever marking the document. A minimal page bar
  (‹ 2/5 › ✕) wakes on mouse move and fades away; every editing key is
  disabled during the show; Esc exits and restores camera, tool and
  chrome exactly as they were.

## v3.21.0 — 2026-08-03
- **Tooltips everywhere.** Every button in the app — tools, top-bar
  toggles, style panel controls, zoom bar, art styles, templates — now
  shows a fast, styled tooltip on hover: the tool's name plus its
  keyboard shortcut rendered as a key chip. Tips appear in ~⅓ of a
  second (instantly when scanning along a row of buttons), flip above
  controls near the bottom edge, follow the light/dark theme, and always
  reflect live state (the grid button says which mode is active). The
  browser's slow native bubbles are gone; the five highlight-color dots
  got names too.

## v3.20.1 — 2026-08-03
- **Replay the welcome.** ? → Settings → "Show the welcome screen again"
  brings the first-run welcome card back on demand — for reviewing it, or
  for showing someone the intro on a machine that has already seen it.
  Dismissing it never touches the current document.

## v3.20.0 — 2026-08-03
- **Undo that matches intention.** Rapid repeats of the same
  micro-operation now fold into one history step: ten arrow-key nudges
  undo with a single ⌘Z (instead of ten), and quick successive wiggles of
  the opacity or photo-adjustment sliders merge too. Any unrelated edit,
  or an undo/redo, cleanly ends the run so nothing ever merges across
  different operations. Slider drags were already one step per gesture.

## v3.19.0 — 2026-08-03
- **Carousel export.** ☰ / ⬇ → "Export all pages as PNGs (.zip)": every
  page renders to a numbered PNG (named `01-PageName.png`…, exact artboard
  pixels when a canvas size is set) and lands in one .zip. The ZIP writer
  is hand-rolled (store method, ~50 lines) — dependencies stay at zero,
  and the archive passes `unzip -t` with correct CRCs.
- **Copy as PNG (⇧⌘C) and Copy as SVG.** The selection — or the whole
  page when nothing is selected — goes to the system clipboard as a real
  PNG image (paste into Slack, Notion, Keynote…) or as SVG markup (paste
  into Figma or a code editor). Both also live in the ☰ and ⬇ menus.

## v3.18.0 — 2026-08-03
- **Touch & iPad support.** Pinch to zoom around the fingers' centroid,
  which gives two-finger panning for free. A second finger landing
  mid-gesture safely cancels whatever the first finger started (any
  half-done drag reverts to the last committed state). Selection,
  rotation, curve and elbow handles grow their hit areas 1.8× under a
  finger, and the canvas suppresses long-press callouts and text
  selection on touch devices.

## v3.17.0 — 2026-08-03
- **First-run welcome.** A brand-new browser gets a warm welcome card:
  the paper-thought mark, the motto, and two choices, "Take the 60-second
  tour" (loads the KoralPaper tour in place of the empty page) or "Start
  with a blank page". Shown exactly once; returning users and anyone with
  an autosaved document never see it.
- **Empty-canvas guidance.** A completely blank document shows faint
  centered hints (R rectangle, A arrow, T text, ? for help) that vanish
  forever the moment the first element lands. No overlay, no dismissing:
  it is drawn on the paper itself.

## v3.16.0 — 2026-08-03
- **Rendering performance layer.** While you drag, resize, rotate, bend an
  arrow, marquee-select or pan, everything that isn't moving is rasterized
  once to an offscreen bitmap and each frame just blits it, redrawing only
  the moving elements (plus any arrows glued to them). On a 300-element
  document a drag frame drops from ~4.2ms to ~0.03ms — heavy documents now
  drag as smoothly as empty ones. Pans blit a padded snapshot and re-render
  fully on release; the cache lives only for the duration of one gesture,
  so the settled picture is always the true full render.

## v3.15.0 — 2026-08-03
- **"One line" rebuilt for faces.** Four compounding fixes make the single
  continuous line actually read as a portrait:
  - Contour chains are now ranked by **total edge strength**, not length —
    short-but-strong features (eyes, glasses, lips, nostrils) finally beat
    long hair edges for a place in the drawing.
  - **Coverage-aware selection** spreads the line budget across the whole
    face instead of clustering where edges happen to be longest.
  - The line now grows from **both ends** with much tighter connector
    curves, roughly halving the wandering pen travel between contours.
  - Fine detail level keeps its detail: lighter blur, denser sampling,
    gentler smoothing, more and shorter chains (12 / 26 / 50).

## v3.14.0 — 2026-08-03
- **Your gallery** — a new toolbar button holds your reusable assets:
  upload **SVG logos** (kept as pure vector — crisp at any size and
  exported as vectors) and **transparent PNGs** (downscaled for storage,
  transparency preserved). Click an asset to place it at the center of
  the view, right-click to remove it. The gallery persists in the browser,
  and placed assets are ordinary image elements — resize, rotate, glue
  arrows, even run Art styles on them; documents stay fully portable.

## v3.13.1 — 2026-08-03
- **Formatting is visible while you edit.** Bold, italic and highlights
  now render live during editing — the canvas draws the styled text in
  place, and the editor overlay contributes only the caret and the
  selection band. Press ⌘B mid-edit and see it instantly.

## v3.13.0 — 2026-08-03
- **Bold, italic & highlight — on whole texts and selected ranges.**
  A new Format row (B / I / highlight dots) plus shortcuts: ⌘B, ⌘I, ⇧⌘H.
  With an element selected they style the whole text; while typing, select
  characters first and only that range is styled — mix bold words, italic
  asides and highlights freely inside one text, shape, or arrow label.
- **Highlight colors**: five presets (yellow, green, pink, blue, peach),
  a custom color wheel + hex, and a remove button; the last used color
  becomes the ⇧⌘H default.
- Styled ranges survive further editing (formatting stays anchored to its
  characters as you type around it), wrap correctly with their true bold /
  italic widths, and export faithfully to SVG, PNG and PDF.

## v3.12.0 — 2026-08-03
- **Settings export / import**: Settings now ends with "Export settings…"
  (downloads a dated `koralpaper-settings-….json` carrying line widths,
  text sizes, spacing defaults, and your pinned Material icons) and
  "Import settings…" (loads such a file, applies everything live — sliders,
  drawing defaults, pins — and persists it). Reload a past setup anytime,
  or carry your configuration to another machine.

## v3.11.1 — 2026-08-02
- **Per-category resets in Settings**: the single "Reset to defaults"
  button is replaced by three — "Reset line widths", "Reset text sizes",
  and "Reset text spacing" — each restoring only its own section, so
  tuning one category never wipes the others.

## v3.11.0 — 2026-08-02
- **Spacing defaults live in Settings**: three new sliders (Lines /
  Paragraph / Letters) define your default text spacing — every new text
  uses them, they persist across sessions, and Settings' "Reset to
  defaults" restores the factory values.
- **"Reset spacing" resets to *your* defaults** (from Settings), and the
  hint shows the exact values it applied.
- **Fixed the audit finding behind "reset not working"**: newly created
  elements ignored the current spacing defaults, so new and existing
  texts could disagree even after a reset. New elements now inherit line
  spacing, paragraph gap, letter spacing, and vertical alignment.

## v3.10.2 — 2026-08-02
- **Paragraph spacing works on a single Enter**: every hard line break now
  receives the paragraph gap, while soft-wrapped lines inside shapes keep
  the line spacing — so the two sliders stay independent where it matters.
- **Slider values always visible**: the Spacing section shows each value
  (×1.3, 24px, 0px) in bold on its own header line above a full-width
  slider — easy to read and easy to match across every text in a document.

## v3.10.1 — 2026-08-02
- **Typography tuning**: line spacing now ranges ×0.5–2.5 and letter
  spacing −7 to +15px. **Paragraph spacing redefined** — a paragraph is a
  block separated by an empty line (double Enter), so the slider no longer
  stretches ordinary line breaks; it adds space only between real
  paragraphs. Slider relabeled "Paragraph".

## v3.10.0 — 2026-08-02
- **Typography controls** for all text — standalone text, text inside
  shapes, and arrow/line labels:
  - **Line spacing** slider (×0.9–2.4, default ×1.3).
  - **Paragraph gap** slider (0–48px): extra space added at every hard
    line break (Enter). Inside shapes, soft-wrapped lines keep the normal
    line spacing while your typed paragraphs get the gap.
  - **Letter spacing** slider (−2 to +12px tracking).
  - **Vertical alignment** for text inside shapes: top / middle / bottom.
  - All four travel with copy/paste-style, save into documents and
    templates, and export identically to SVG, PNG and PDF; the in-place
    text editor mirrors line spacing and tracking while you type.

## v3.9.0 — 2026-08-02
- **Robust template system**:
  - Save **multi-page templates** — "Save this page…" or "Save all
    pages…" capture the design with its canvas size *and* paper color.
    (With a multi-page document, Update also asks which scope you want.)
  - **Every template is editable** — rename (✎), update-in-place with
    your current design (↻), and delete (✕) work on your templates *and*
    on the built-ins: replace a built-in with your own version or remove
    it from the list entirely.
  - **"Restore built-ins"** appears whenever a built-in was customized or
    deleted, and brings the originals back with one click.
  - Template rows now show what's inside: page count, canvas size (or
    unlimited), custom paper, and a "customized" tag on modified built-ins.

## v3.8.0 — 2026-08-02
- **The demo is now the KoralPaper tour**: ☰ → "Load the KoralPaper tour"
  replaces "Load the demo sketch". It adds a 1920×1080 page where every
  feature demonstrates itself — glued/curved/elbow/dashed arrows with
  labels and arrowheads, neat mode, icon stamps incl. Google Material
  icons, four Google Fonts, all six fill styles, sticky notes, free draw,
  and chips for templates/pages/exports. Loads as a new page (nothing of
  yours is replaced) and works fully offline. The same document ships as
  `examples/koralpaper-tour.json`.

## v3.7.1 — 2026-08-02
- **Font library kept curated**: the Archivo family added in v3.7.0 is
  removed again. The Black carousel template now uses **Space Grotesk**
  throughout — the design's own body face — so headings and text share one
  family from the existing list. Any elements already created with Archivo
  migrate to Space Grotesk automatically.

## v3.7.0 — 2026-08-02
- **New template: "Black carousel"** — a faithful conversion of an
  HTML carousel design (1080×1350, black paper, electric-yellow accent,
  Archivo + Space Grotesk) into fully editable KoralPaper pages. Three of
  its layouts ship: **Stats** (big yellow figures with hairline dividers),
  **Highlight word** (headline with a yellow highlight chip + image
  placeholder), and **Numbered steps** (01/02/03 with titles and dim
  captions). Everything is drawn neat (no wobble) to match the source.
- Templates can now set the **paper color** (this one turns the paper
  black; ☰ → "Reset paper color" restores the theme).
- **Archivo** joined the font library (Sans & display).

## v3.6.0 — 2026-08-02
- **White joins the palettes**, and both stroke and fill now open with a
  clean neutral ramp: black → dark grey → grey → light grey → **white**,
  followed by the colors (fill keeps cream right after the ramp). White
  stays true white in dark mode too — handy for chalk-style lines on ink
  paper.

## v3.5.1 — 2026-08-02
- **Fixed: the Text tool places text again.** Clicking with the Text tool
  created the editor, but the browser's default click behavior immediately
  moved focus away — the editor blurred, committed its empty text, and
  deleted it, so nothing ever appeared. The click's default action is now
  suppressed for text placement, and the editor re-claims focus if
  anything steals it in the same tick.

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
