# KoralPaper — Changelog

## v3.64.0

- Stop-motion is now the soul of the time-lapse, and the default. A real time-lapse is not smooth motion design: things move in discrete, slightly shaky steps, like photos taken one by one. The new Stop-motion easing moves elements in about 8 distinct positions per second, adds a tiny deterministic hand-shake to every element on every step, and re-seeds the sketchy strokes so the whole drawing "boils" as if redrawn by hand for each photo. On hold frames everything settles perfectly still. The camera still glides smoothly between camera keyframes, like a rig, while the objects step.
- Fade now defaults OFF: elements that appear or disappear hard-cut, the traditional time-lapse feel. Tick Fade only when you want cross-fades. Smooth, Snappy, Overshoot and Linear remain available per frame when a story calls for motion design instead.

## v3.63.0

- Time-lapse v2, from slideshow to motion design. Every keyframe now has a hold time (how long it stays still) and a move time (how long it animates into the next frame). During the move, elements with the same identity glide between positions, resize, rotate, fade and recolor smoothly; elements that appear or disappear fade in and out, or hard-cut if you switch Fade off. Four easing personalities: Smooth, Snappy, Overshoot (a bounce past the target, then settle) and Linear, plus 10 / 20 / 25 fps for export smoothness. Frames captured before v2 keep working exactly as before: move defaults to 0, which is the old hard cut.
- Camera keyframes: switch on 🎥 and each new frame remembers your current zoom and position. The export then travels between them, so you can start tight on a detail and pull out to reveal the whole board.
- Live preview with scrubber: ▶ plays the full animation, motion and all, in a small player above the bar. Drag the scrubber to any moment. No more export-to-check loops.
- Onion skin: 👻 shows the selected frame as a ghost under the live page, so you can place the next keyframe precisely.
- Recordings now survive reload: frames are saved with the document (autosave and .json files), including any images they reference.
- Smarter GIF engine: every frame after the first encodes only the rectangle that actually changed, with untouched pixels transparent. Lossless, and it applies to the page-based GIF export too. Exports also keep running when the tab is in the background, with a progress bar on the bar.

## v3.62.0

- Time-lapse recorder: ☰ → "Time-lapse recorder" opens a frames bar above the page strip. Two ways to capture: press F (or the camera button) to snapshot the page as a frame, or switch on ● auto-record and every change you make becomes a frame automatically while you simply work. Frames are element states, not pixels: click one to select it, double-click to put that moment back on the page (undoable), right-click to delete, arrows to reorder, and give any frame its own duration.
- Export the sequence as a looping GIF or a .webm video at 480 / 720 / 1080 width, straight from the bar. Stop-motion carousels, elements flying into place, or a recording of Claude building your page through the bridge: a content format no other canvas produces.

## v3.61.0

- Animated GIF export: ⬇ → "Animated GIF" turns your pages into a looping GIF, one frame per page. Full control: tick which pages to include, give every frame its own on-screen duration (0.1 to 30 seconds, plus an apply-to-all shortcut), choose 480 / 720 / 1080 px width, and toggle looping. The encoder is built into the app (zero dependencies, like everything else): your carousel becomes a scroll-stopping animation without any external tool.

## v3.60.1

- The Corners slider now also fine-tunes rectangles: sharp to full pill, same dial as photos. The classic sharp/rounded buttons still work and reset the fine value.
- Panel polish from the audit: the "Reset spacing" button matches every other panel button, and the font name gets twice the width of the weight button so it stays readable.

## v3.60.0

- Paste a picture into a shape: select a rectangle, ellipse, diamond or chip and paste an image from your clipboard (Pinterest, a screenshot, anywhere). The picture fills the shape, cover-fitted and clipped by the sketchy outline, rounded corners included. Right-click the shape to remove the image fill. Works in every export as a true clipped vector group.
- Rounded corners for photos: image elements get a Corners slider in the panel, from sharp (0) to a full pill (50). The radius scales with the image, the hand-drawn frame follows it, and it applies to tinted SVGs and all 13 art styles too.

## v3.59.1

- Panel polish: the font and weight buttons share one line, and the exact-size field sits inline with S / M / L / XL at the same 30 px height, like a fifth button, instead of stretching taller and wrapping.

## v3.59.0

- Exact font size, visible and editable: the Size row now shows the selection's true pixel size in a small field next to the S / M / L / XL presets. Handle-resized text no longer hides its size: read it, or type an exact value (8 to 600, Enter applies). Mixed selections show an empty field.
- Copy and paste just the text size: right-click any element with text → "Copy text size (47px)", then right-click others → "Paste text size". Like copy/paste style, but only the size, perfect for making drifted headlines match again.

## v3.58.0

- Your color library: save any color from the color wheel popover (the ★ Save button) and it appears as a round swatch in the Outline, Fill and Text color rows, working everywhere colors work, including coloring selected letters. Right-click a round swatch to remove it. Up to 24 colors, kept in your browser.
- Templates feed the library: applying a template automatically adds its distinctive colors (custom hexes and colorful palette tones, never the neutral greys and paper) as round swatches, so a template's look becomes reusable paint the moment you add it.

## v3.57.1

- Text elements can wrap: dragging a text box's left or right handle now sets its width and the text reflows into lines, with the font size untouched (this replaces the side handles doing nothing since v3.53). Corner handles still scale the type, keeping the wrap width in proportion. Right-click a wrapped text → "Fit width to text" returns it to one auto-sized line. Wrapping carries into SVG and every export.

## v3.57.0

- Make your own stamps: select anything on the canvas, right-click → "Save to gallery…", give it a name, and it becomes a reusable vector asset. Stamps stay pure SVG: place them anywhere, tint them any color, and they export as real editable vectors. Your sketches become your icon library.

## v3.56.1

- Copy as SVG and SVG export now inline your gallery SVGs as real vector markup (paths, text, shapes), not as an embedded image object. Other tools that open the file see editable vectors. Tint and crop carry over (crop becomes precise viewBox math), scripts and event handlers are stripped from the inlined markup for safety, and raster images keep using the image tag as before.

## v3.56.0

- SVG assets are now recolorable: place a gallery SVG and the Outline row becomes "Tint". Pick any color and the whole mark recolors (transparency preserved), vector-crisp on canvas and in SVG export, where the original SVG source is kept and tinted with a real SVG filter. "None" restores the original artwork colors. To be clear about the reported concern: gallery SVGs were always stored and exported as SVG; what was missing was color control, and now it exists.
- README: a full badge wall (platforms, offline, privacy, Claude, charts, fonts, brand kit, security) and a 12-feature visual showcase grid, ready for screenshots.

## v3.55.0

The three completing features.

- Heat map: the eighth chart type. Rows and columns become a colored grid where deeper color means a higher value, with column headers, row labels, a 1-to-max gradient legend, and optional value numbers with automatic light-on-dark contrast. Uses your first brand accent as the heat color when a kit is active.
- Prompt recipes: the Claude tab now has five click-to-copy prompts for the moves that work: Tidy this page, Rebuild it clean, Turn into a mind map, Make a carousel of it, Summarize the document. Click, paste into Claude Desktop, done.
- Snapshots: ☰ → Snapshots saves a named checkpoint of the entire document (pages, images, board, paper) in your browser. Restore any checkpoint at any time; one undo brings the pre-restore version back. Up to 8 snapshots, with honest messages when storage runs low.

## v3.54.1

- Brand kit polish: six accent colors instead of four, every color swatch shows its hex value underneath (updating live while you pick), and the Settings buttons are tidy auto-width rows instead of stretched pills. Older four-color kits keep working as they are.

## v3.54.0

- Brand Kit: define your identity once in Settings: a name, four accent colors, a paper color, and a heading + body font (any Google font). When the kit is active:
  - charts color their series with your accents, and chart titles use your heading font
  - built-in template headlines switch to your heading font
  - new documents start on your brand paper
  - the four accents appear as extra swatches in the Outline, Fill and Text color rows
  - Claude reads the kit through the bridge and designs on brand automatically
- Export the kit as a .json file and import it anywhere: give a whole team the same look with one small file. Turning the kit off restores every default instantly.

## v3.53.1

- Fix: merging kept every text's color wrong when the target had its own color logic. A black text merged into a yellow shape stays black now. Each merged line keeps its exact original color (as letter colors where needed), in both "Merge texts into one" and "Merge text into the shape", and existing letter colors are never overwritten.

## v3.53.0

- Merge text into a shape: select one shape plus any number of text elements and right-click → "Merge text into the shape". The texts become the shape's own label, in the order you selected them, keeping bold, highlights and letter colors. An empty shape adopts the first text's font, size, weight and color, so the look carries over.
- Smarter resizing for anything with text: the side handles now stretch only the geometry and never touch the font size, on shapes and on text elements alike. The corner handles scale the type along with the shape, which is also new for shapes (their labels used to stay tiny no matter how big you dragged them).

## v3.52.0

Security and consistency pass, following a full audit.

- Content Security Policy: the app now ships a strict CSP. Scripts run only from the app itself, connections are limited to Google Fonts and the local Claude bridge, and plugins/objects are blocked entirely. Defense in depth on top of the existing no-injection architecture (the app builds all UI via safe text APIs, verified: zero innerHTML anywhere). Works on the web app, the installed PWA, and the double-clicked offline file.
- Custom Google font names are now strictly validated (letters, digits and spaces only) before they reach any URL, closing a parameter-smuggling niche in crafted documents.
- Opening a file now has honest safety limits: a friendly message instead of a frozen tab for files over 150 MB or documents beyond 50,000 elements.
- The PDF export dialog now follows the standard dialog pattern (coral primary first, right-aligned row) like Templates and Charts.
- One selection color everywhere: the grid popover now selects in coral like every other segment control.
- Escape now also closes the Chart dialog and the font and weight menus.
- Removed the last visible em dashes from the gallery hint, grid header and Settings texts.

## v3.51.1

- New canvas presets: "LinkedIn portrait" (1080 × 1350) in the Social group and "4 : 5" (1200 × 1500) in the Ratios group.

## v3.51.0

- Page colors now tint only the canvas itself: with an artboard set, a page-only paper color fills exactly the artboard, and the workspace around it keeps the neutral document tone. Coloring the whole view still works via "All pages".
- Merge texts: select two or more text elements (shift-click them in the order you want the lines) and right-click → "Merge N texts into one". The lines join in your selection order as one text element, keeping bold, italics, highlights and letter colors intact. Perfect for when Claude delivers a paragraph as separate lines. One undo splits it back.

## v3.50.0

- Per-page paper color: the paper popover (round swatch, top right) now has an "All pages / This page" switch. "This page" colors only the page you are on, so one black page can live inside an otherwise white document. A page's own color always wins over the document color; "Reset paper color" clears both for the current page.
- Everything respects it: the canvas, page thumbnails, PDF export, PNG carousel export, shared HTML, and the grid contrast on each page.
- Templates saved from multi-colored documents keep each page's paper, and Claude's pages now set their paper per page too: replicating several posters keeps each page's own background instead of the last one winning.

## v3.49.1

- Fix: dragging a text block's corner handle stopped growing the text at 200 px. Text now scales up to 600 px by dragging, and Claude can set sizes up to 600 too. Poster headlines can be as big as the page.

## v3.49.0

- Search all of Google Fonts: the font picker has a search field. It filters the built-in collection, suggests popular Google fonts, and any exact family name can be loaded on demand ("Load ... from Google Fonts"). Loaded fonts are remembered in a "Your Google fonts" group, and documents stay portable: the font travels inside the file and reloads automatically on any machine.
- Font weights: a new weight button next to the font picker offers the full range, 100 Thin to 900 Black, per element. Weights flow through the canvas, the text editor, SVG/PDF export and copy style. Variable fonts get their entire range; fonts without a weight snap to the nearest available one.
- Claude can use both: elements accept "font": any Google family name (e.g. "Anton", "Archivo Black") and "weight": 100-900. The replica and design prompts teach this, so recreated posters now match typefaces and weights, not just layout.

## v3.48.0

- Recreate a design from an image: the Claude tab in Help now has a "Copy the replica prompt" button. Paste the prompt into Claude Desktop together with a poster, slide or PDF page (several images = several pages) and Claude rebuilds it in KoralPaper: exact texts, sampled colors, proportional layout, one page per image, checking its own result with a rendered screenshot and correcting up to 3 rounds.
- Claude bridge 1.3.0: elements accept "bold": true (bold headlines and labels) and font sizes up to 300 px for poster type. Update the extension by double-clicking the new mcp/koralpaper.mcpb; the replica prompt also documents the flag, so it works with the old extension too.
- The design prompt (no-desktop route) now documents runs: bold, italic and per-letter colors in saved JSON files.

## v3.47.0

- Two chart styles: a Style row in the dialog switches every chart and table between Sketchy (the hand-drawn wobble) and Clean (crisp, straight, professional). It applies to all types: tables, bars, pies, donuts, lines and spiders, including the legend and labels.
- Pie and donut slices are drawn tighter: no more thin seams between slices, and in Clean style the wedge corners are perfectly sharp.
- The style is saved per chart and preserved through "Edit chart data", so the same numbers can live as a sketch on one page and a boardroom version on another.

## v3.46.0

- Value labels: a new Labels row in the chart dialog. Tick "Values" and every number is written on the chart: above each bar (below for negatives), at each point of a line, and just outside each vertex of a spider, colored per series.
- Pies and donuts get independent "Values" and "Percent" checkboxes, so slice labels can read "Consulting · 45", "Consulting · 45%", both, or just the name.
- Legend position: choose Top, Bottom, Left or Right in the new Legend row. Left and right stack the entries vertically. Applies to bars, lines and spiders with more than one series.
- All options are saved with the chart and preserved through "Edit chart data".

## v3.45.0

- Grid control for charts: a new Grid row in the dialog sets the style (Solid / Dash / Dots) and weight (Thin / Std / Bold) of the grey guide lines. It applies to the gridlines of bar and line charts and to the web rings and spokes of spider charts.
- Curviness slider: the Lines row now has a 0 to 100 slider instead of the on/off checkbox. 0 is straight segments, 100 is fully curved, and anything between bends gently. Data points stay exact at every setting. Works on line charts (default 100) and spider charts (default 40 for new ones; existing spiders stay straight until you raise it).
- Value dots are now available on spider charts too.
- All of it is remembered per chart and preserved through "Edit chart data".

## v3.44.0

- New chart type: Spider (radar). Each row is one spoke; each value column is one series drawn as a translucent filled shape with a crisp outline. The web grid, scale numbers, axis labels and legend are generated for you. Works with multiple series, keeps every value exactly on its spoke, and selecting an outline reveals its value rings, just like line charts.

## v3.43.0

- Line charts are curved again, correctly this time: the new curves are interpolating splines, so they bend smoothly AND pass exactly through every value. A "Curved lines" checkbox in the dialog switches back to straight segments.
- Value dots are now optional and OFF by default ("Value dots" checkbox). Instead, selecting a line on the canvas reveals small rings at its data points, so the values are there when you want to inspect, invisible when you present.
- Both options are remembered per chart and preserved through "Edit chart data".

## v3.42.2

- Fix: line charts now pass exactly through their data points. The freehand smoothing was treating the few chart points as loose curve guides, so lines drifted far from the markers (very visible with negative values). Chart lines are now built from a dense point path, keeping the hand-drawn feel while honoring every value. Existing charts pick up the fix the next time you use "Edit chart data" and Update.

## v3.42.1

- Fix: pressing Tab inside the chart data box now types a column separator instead of jumping to the next field, so you can type any number of columns by hand. Shift+Tab still moves focus away for keyboard navigation.

## v3.42.0

- New: Charts & tables. Press B or click the new toolbar button, paste numbers straight from Excel or Numbers (or type them), pick a type, and it appears on the page: vertical or sideways bars (multi-series, negative numbers supported, zero line included), line charts with markers, pies, donuts, and elegant striped tables with a coral header. Title, X and Y axis labels, legend and value gridlines are generated for you, with a live preview in the dialog.
- Charts are made of normal KoralPaper elements in one group: every bar, slice, line and label recolors, restyles, moves and exports exactly like anything else you draw.
- Right-click any part of a chart and choose "Edit chart data" to reopen the dialog with your numbers and rebuild it in place (one undo step).
- Freehand draw paths can now carry a fill color (this is what pie slices are made of), and the Fill row in the panel appears for them.

## v3.41.0

- Color single letters: while typing in any text, select some characters and pick a Text color in the left panel. Only that range changes color; the auto dot puts it back. Works with the custom color wheel, combines freely with bold, italic and highlights, and carries through PNG, SVG, PDF and shared HTML exports.
- Without a character selection the Text color dots keep coloring the whole text, exactly as before.
- Template categories now expand and collapse: click a category header to fold it away. Each header shows how many templates it holds, and the folded state is remembered.
- New Help card tip explaining letter coloring.

## v3.40.0

- Templates are now organized in categories: Carousels, Presentations, Infographics, Diagrams, plus any category you create yourself. Built-ins and your own saves live together under coral group headers; your templates carry a coral star.
- Saving a template is a proper form inside the dialog: type a name (or keep the page name), pick a category or choose "New category" to create one, then Save this page / Save all pages. No more chained popups.
- The rename action (pencil) now also lets you move a template to a different category.
- Dialog buttons cleaned up: primary coral pill for the main action, right-aligned secondary buttons, separated footer. This is the standard action-row pattern for all app dialogs going forward.
- Removed em dashes from all on-screen hint texts and template descriptions.

## v3.39.0 — 2026-08-04
- **A real font picker.** The Font dropdown was a native browser
  control, which is why its group labels could not match the app's
  style. It is now a KoralPaper popover: coral group headers (Built-in,
  Sans & display, Serif, Mono, Hand & script, Pixel & dot) — and every
  font name is previewed **in its own typeface**, so you see what
  Playfair, Caveat or JetBrains Mono actually look like before
  choosing. The current font is highlighted and scrolled into view,
  and the Font button itself shows the active font in its own face.

## v3.38.0 — 2026-08-04
- **Page through all 3,000 Material icons.** The icon popup's grid was
  stuck at nine icons; it now has ‹ › arrows with a page counter.
  Browsing walks the whole catalog (pins and recents first), searching
  pages through every match instead of silently truncating at nine,
  and the pager hides itself when one page is enough.
- The "Google Material icons" header now wears the same coral section-
  title style as every other menu header in the app.

## v3.37.0 — 2026-08-04
- **Frames for images.** Select a photo → the new **Frame** row (Off /
  On): a hand-drawn border hugs the image, using the same Outline
  color, Thickness and Line style controls you already know — sketchy
  ink, neat dashed blue, thick coral, anything. The frame stays on
  through every art style (halftone, lines, stipple…), so light-
  background photos keep a robust presence on the page whatever look
  they wear. Carried by copy/paste style, exports (PNG/SVG/PDF/share),
  one undo step per toggle.

## v3.36.1 — 2026-08-04
- Export menu visibility polish: the "This page" and "Whole document"
  group headers are now coral so the categories signpost clearly, and
  the "Transparent background" toggle is bold with a visible empty
  checkbox even when unchecked.

## v3.36.0 — 2026-08-04
- **Two menus, two jobs.** The ☰ menu now holds only the document and
  the show: New / Open / Save / Import / Templates, then Present /
  Replay / Tour, then paper housekeeping — ten items with their
  shortcuts shown, instead of twenty-four. Everything about getting
  work OUT lives in the ⬇ export menu, grouped under "This page"
  (PNG, SVG, copy to clipboard) and "Whole document" (PDF, PNG zip,
  web page, replay video, Excalidraw).
- **One Transparent-background toggle** at the top of the export menu
  replaces the four "± transparent" rows: tick it once (it is
  remembered) and every PNG and SVG export honors it. The menu stays
  open while you flip it.

## v3.35.0 — 2026-08-04
- **The style panel speaks human now.** Section titles renamed for
  first-time users: Stroke → **Outline** (and **Line color** when an
  arrow or line is selected — the label adapts), Fill style → **Fill
  pattern**, Width → **Thickness**, Text → **Text color**, Format →
  **Emphasis**, Vertical → **Text position**, Spacing → **Text
  spacing**, Layer → **Order**, Art style → **Photo style**. Nothing
  moved, nothing was removed.
- **Fold what you never use.** Every panel section title is now
  clickable: a small chevron folds the section to just its name, and
  your folds are remembered per browser. Everything starts open, so
  the full richness stays until YOU decide to compress.
- **Duplicate / Delete / Group always in reach.** The action buttons
  are pinned to the bottom edge of the panel — visible without
  scrolling, however long the panel gets.
- For plain text elements the Outline row is gone — Text color is the
  single source of truth. Opacity shows its percentage next to the
  title, and a subtle divider separates the shape, text, and arrange
  zones.

## v3.34.0 — 2026-08-04
- **Drag pages to reorder.** Grab any thumbnail in the page strip and
  drag it: a coral insertion mark shows where the page will land, and
  the move is one undo step. A plain click still switches pages, and
  the right-click menu keeps Move left/right.
- **Arrange panel, one logic per line.** The Arrange section now groups
  its buttons the way you think: horizontal aligns (left · center ·
  right) on one line, vertical aligns (top · middle · bottom) on the
  next, then distribute, match-size and Tidy together.

## v3.33.0 — 2026-08-04
- **Mind-map folding.** Right-click any shape → "Mark as mind-map root"
  and the diagram becomes a foldable mind map: every node with children
  grows a small badge — **−** folds the branch, a coral **+N** shows how
  many nodes a click reveals. Visibility is derived live from the glued
  arrows, so cross-links behave correctly: a shared child stays visible
  while any expanded path still reaches it, and folded branches
  remember their own inner folds. Works mid-presentation (tap the badge
  to unfold while talking; anywhere else still turns the page), every
  fold is one undo step, the folded state saves with the document, and
  exports show exactly what you see. Folded elements are never deleted
  — unmark the root and everything returns. Claude reads and can set
  the folded state through the bridge too.

## v3.32.0 — 2026-08-04 (bridge 1.2.0 — update the extension)
- **The Claude bridge now trusts only KoralPaper.** Browser requests to
  the local bridge are accepted only from the app's own homes — a
  file:// copy, localhost, or the official karagos.github.io page — and
  must carry the app's identifying header. Any other website you might
  visit gets a hard 403 and no CORS approval, so a malicious page can
  no longer read your document or scribble on your paper through the
  local port. Native Claude processes are unaffected.
  **Action needed once: double-click the new `mcp/koralpaper.mcpb`**
  (bridge 1.2.0) so the extension and app speak the same handshake.
- Friendlier error when opening a file that isn't a KoralPaper sketch:
  it now says what the app can open and why the file was rejected.

## v3.31.0 — 2026-08-04
- **Windows and Linux see their own keys.** Every shortcut already
  worked with Ctrl and Alt; now the labels say so too. On non-Mac
  systems, tooltips, the Help card, menu shortcuts and hints all show
  Ctrl+Z, Ctrl+Shift+Z, Alt+drag and friends instead of ⌘/⇧/⌥. Macs
  keep the symbols.
- **iPad layout pass.** At tablet widths the toolbar wraps neatly, the
  style panel slims down and starts below it, the zoom bar compacts,
  and the brand shrinks. On touch devices every hit target grows: 42px
  tool buttons, 28px swatches, taller menu rows, chunkier page tabs and
  sliders. Combined with the existing pinch/two-finger-pan support,
  KoralPaper is now genuinely comfortable on an iPad.

## v3.30.0 — 2026-08-04
- **Shared image store (save format v6).** Image pixels are now stored
  ONCE per unique image and referenced by id, instead of being embedded
  in every element, every undo snapshot, and every autosave. The
  numbers: with a photo on the page, each undo step used to carry the
  full photo again (120 snapshots × every image); now snapshots are a
  few KB regardless of photos, duplicated photos share one copy, and
  .json files shrink accordingly. Undo depth, memory use and autosave
  headroom all improve at once — this directly delays the "document too
  big to autosave" ceiling.
- Fully backward compatible: old .json files and old autosaves load
  exactly as before (their embedded images are adopted into the store
  on open). Templates remain self-contained and carry their own pixels;
  crop, photo adjustments, all 13 art styles, Excalidraw round trips,
  copy/paste and the Claude bridge are unaffected — all verified.

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
