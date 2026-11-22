# KoralPaper × Claude Desktop

Let Claude design pages directly on your KoralPaper paper.

## Install (once, about a minute)

1. Install the free [Claude Desktop](https://claude.ai/download) app and sign in.
2. Double-click **`koralpaper.mcpb`** and confirm the install inside Claude Desktop.
3. Open KoralPaper (`index.html`) in your browser. A pulsing ✳ appears in the
   top bar when the link is alive.

No API key, no terminal, no extra billing: your existing Claude subscription
does the thinking, and nothing leaves your machine except your conversation
with Claude.

## Use

Just talk to Claude Desktop:

- "Draw a customer onboarding flowchart with five steps on a 1920×1080 board."
- "Read my KoralPaper page and tidy the layout, keep my colors."
- "Turn these meeting notes into a decision tree on a LinkedIn carousel board."

Everything Claude draws is an ordinary KoralPaper element: move it, restyle it,
undo it (one ⌘Z per step Claude takes). Claude can read the current page and
look at a rendered picture of it, so follow-ups work on whatever is on the
paper, including things you drew by hand.

- "Make a 10-page 1080×1350 carousel about AI myths in a new document, in Inter
  Tight, with a page number in the footer, and export it as a PDF."
- "I left comments on the cover. Fix them and reply to each one."

## Tools (21)

| Tool | What it does |
|------|--------------|
| `koralpaper_status` | Is the app open and linked, and which document is on screen |
| `koralpaper_list_documents` | Every document in the app, with its snapshots |
| `koralpaper_create_document` | A new, separate document with an artboard |
| `koralpaper_open_document` | Show an existing document |
| `koralpaper_read_document` | Pages and elements (images and line ends included), with a version per page |
| `koralpaper_create_page` | One page, or several in one call, with shapes, text and pictures from files |
| `koralpaper_add_elements` | Add elements to a page |
| `koralpaper_update_elements` | Change elements by id |
| `koralpaper_delete_elements` | Delete elements by id |
| `koralpaper_render_page` | A picture of a page, to check the layout |
| `koralpaper_measure` | Text, shapes, images and lines: line breaks, overflow, artboard edge, safe area |
| `koralpaper_export` | PDF (with selectable text), PNG or JPG files into a folder inside Documents |
| `koralpaper_get_selection` | What the user has selected |
| `koralpaper_get_changes` | Added, changed and removed elements since a version |
| `koralpaper_list_comments` | Comments pinned to elements |
| `koralpaper_reply_comment` | Reply, and mark resolved |
| `koralpaper_snapshot` | Save a named checkpoint of a document |
| `koralpaper_restore` | Put a document back to a snapshot |
| `koralpaper_set_styles` | Named text styles and colour tokens |
| `koralpaper_set_master` | Elements on every page, with automatic page numbers |
| `koralpaper_set_board` | The artboard size and the safe area of a document |
| `koralpaper_delete_page` | Delete one page |
| `koralpaper_rename_page` | Rename a page |
| `koralpaper_set_page` | A page's name and paper colour |
| `koralpaper_reorder_pages` | Put the pages in a new order |
| `koralpaper_duplicate_page` | Copy a page with everything on it |
| `koralpaper_import_svg` | An SVG as a page of editable elements |

Every drawing and reading tool takes an optional `documentId` and `pageId`.
Without them it acts on what is on screen, exactly as before. Every write takes
an optional `ifVersion`: the page version Claude last read. If the page changed
since, the write is refused and nothing changes.

Each tool's full description, schema and an example are in the tool itself
(`tools/list`), which is what Claude reads.

## Tests

```
node --test mcp/test/*.test.js
```

78 tests drive the real server and the real app in headless Chrome, on test
ports and with a throwaway browser profile, so they never touch port 8137 or
your own documents. They need Google Chrome and Node 22 or newer.

## Files

| File | Role |
|------|------|
| `server.js` | The whole bridge: MCP over stdio for Claude + a localhost long-poll (127.0.0.1:8137) the app listens to. Zero dependencies. |
| `manifest.json` | Extension manifest for Claude Desktop |
| `koralpaper.mcpb` | The one-click installable bundle (zip of the two files above) |
| `test-harness.js` | Dev-only: drive the MCP side from files for testing |
| `test/` | The test suite: `harness.js`, `must.test.js`, `more.test.js` |

Rebuild the bundle after editing: `zip -j koralpaper.mcpb manifest.json server.js`

## Privacy Policy

KoralPaper and this bridge collect nothing. All drawings and settings live only
in your browser's local storage or in files you save yourself. The bridge runs
entirely on your machine and connects Claude Desktop to the app over 127.0.0.1;
it accepts no remote connections, keeps no logs, and stores no data. The only
files it writes are the exports you ask Claude for, inside your Documents folder. Your
conversation with Claude is handled by Anthropic under their own privacy
policy. Full policy: https://karagos.github.io/koralpaper/docs/privacy.html

**KoralPaper is a creation by Stefanos Karagos, CAIO Group ·
[wearecaio.com](https://wearecaio.com)** · MIT
