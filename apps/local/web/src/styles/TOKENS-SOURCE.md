# Design tokens provenance

The `@theme` block in `global.css` is a **verbatim snapshot** of the
mothership's palette + typography tokens.

- **Source path (mothership):** `web/src/styles/global.css`
- **Source repo:** `cogniumhq/skillsregistry` (proprietary)
- **Snapshot SHA:** `4b56a99` — "Trim homepage nav: drop API Status / API Docs, keep MCP up front" (June 2026)

## Why snapshot instead of import

Sacred boundary (`CLAUDE.md`): this repo never imports from sibling repos.
The mothership is not published as an npm package for its web assets.
Copying tokens keeps the visual language consistent while respecting the
one-way dependency direction.

## When to re-sync

Re-sync only when the mothership tokens actually change. Verify with:

```sh
diff \
  ~/work/cogniumhq/skillsregistry/web/src/styles/global.css \
  apps/local/web/src/styles/global.css
```

Then update the snapshot SHA above to record the new sync point.
