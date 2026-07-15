---
'@skillsregistry/mcp': minor
---

Ship `McpPolicyPort` — optional per-tenant tool-visibility gate for the two enforcement points cortex.md §16.4 mandates. Consumers wire an adapter implementing `isToolAllowed(toolName, tenantId): Promise<boolean>` into `McpAdapters.policy`. When present, the dispatcher: (1) filters the `tools/list` advertised set through the policy so a caller only sees tools they can invoke, and (2) re-checks at `tools/call` invocation time and returns `-32601 Method Not Found` for disallowed calls — same shape as an unknown tool, so a caller cannot distinguish "doesn't exist" from "not for you". Omitted policy = allow-all (v1 single-tenant local install posture), no behavior change.

Closes review finding S6.
