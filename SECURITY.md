# Security Policy

## Reporting a vulnerability

If you find a security issue in KoralPaper or its MCP bridge, please email
**karagos@gmail.com** with the details. Please do not open a public issue for
security problems. We aim to respond within a few days.

## Design notes

KoralPaper is a static, offline app. It has no backend, no accounts, and no
telemetry; your drawings live only in your browser's local storage or in files
you save yourself.

The optional MCP bridge (`mcp/`) is a local-only helper that lets an AI client
draw in the app. It:

- listens only on `127.0.0.1` (never on a public interface),
- allow-lists the HTTP `Host` header to `127.0.0.1` / `localhost`, rejecting
  DNS-rebinding attempts,
- allow-lists request `Origin` to the app's own homes and requires a custom
  header on its command endpoints,
- exposes a fixed, typed set of drawing actions with clamped inputs,
- writes files only when asked to export, and only inside your `~/Documents`
  folder: paths that leave it (`../`, absolute paths elsewhere, symlinks that
  lead out) are refused, and existing files are not overwritten unless asked,
- reads no files, and
- has no shell or code-evaluation access of any kind.

SVG handed to the import tool is stripped of scripts, event handlers and
external links before the app looks at it, and the app's content security
policy blocks anything it might still try to load.

The bridge only runs while your MCP client (e.g. Claude Desktop) is running it.
