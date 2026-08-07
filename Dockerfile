# KoralPaper MCP server (stdio). Zero dependencies: no install step needed.
# Used by directory checkers (e.g. Glama) to start the server and introspect it.
FROM node:22-alpine
WORKDIR /app
COPY mcp/server.js ./server.js
CMD ["node", "server.js"]
