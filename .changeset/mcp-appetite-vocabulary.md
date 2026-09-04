---
"@skillsregistry/mcp": patch
---

`search_skills`: the `appetite` input now advertises and validates the domain vocabulary (`strict | cautious | balanced | adventurous`, exposed as a JSON-schema `enum`). The old description suggested `quick | standard | deep`, which the handler forwarded verbatim and which fell through `appetiteToTrustThreshold` with no trust floor. Unknown values are rejected with JSON-RPC invalid-params (#96).
