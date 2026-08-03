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

## Files

| File | Role |
|------|------|
| `server.js` | The whole bridge: MCP over stdio for Claude + a localhost long-poll (127.0.0.1:8137) the app listens to. Zero dependencies. |
| `manifest.json` | Extension manifest for Claude Desktop |
| `koralpaper.mcpb` | The one-click installable bundle (zip of the two files above) |
| `test-harness.js` | Dev-only: drive the MCP side from files for testing |

Rebuild the bundle after editing: `zip -j koralpaper.mcpb manifest.json server.js`

**KoralPaper is a creation by Stefanos Karagos, CAIO Group ·
[wearecaio.com](https://wearecaio.com)** · MIT
