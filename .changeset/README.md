# Changesets

This directory tracks pending version bumps for `@skillsregistry/*` npm packages.

## When you need a changeset

Any PR that changes source in `packages/*` requires a changeset. CI enforces this.

The local app under `apps/local` is versioned separately via Docker tags — it does not use changesets. It's listed in `ignore` in `config.json`.

## Adding a changeset

```bash
pnpm changeset
```

Interactive prompt walks you through:

1. **Which packages changed?** (schema, contracts, domain, mcp, eval, dag)
2. **What kind of bump?** (major / minor / patch — see `principles.md` §Release discipline for rules per package)
3. **What changed?** (one-line summary that lands in the CHANGELOG)

Commit the generated `.changeset/<slug>.md` file with your PR.

## Publishing

Publishing happens automatically:

1. PR merged to `main`
2. Changesets action opens a "Version PR" (or merges immediately if configured) that bumps versions + updates CHANGELOGs
3. Merging the Version PR triggers `npm publish` for every changed package

No manual `npm publish` — CI has the credentials, humans don't.

## References

- Semver rules per package: `.specifica/principles.md` §Release discipline
- Consumer pinning discipline (exact versions in mothership): same section
