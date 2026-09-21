# Design tokens provenance

The `@theme` block in `global.css` is a snapshot of the hosted product's
palette + typography tokens, copied into this repo so the admin UI can
share the visual language without importing from a sibling checkout.

Sacred boundary (`CLAUDE.md`): this repo never imports from sibling repos.
Re-sync only when the hosted palette actually changes; then update
`global.css` and this note.
