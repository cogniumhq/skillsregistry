---
"@skillsregistry/mcp": patch
---

Shrink `list_leaderboard` `kind` schema to `trust` and `agents` only; reject `trending` / `composed` / `forked` with JSON-RPC invalid-params (-32602) instead of advertising kinds that fail at runtime (#116).
