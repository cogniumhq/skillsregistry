---
"@skillsregistry/dag": major
---

Initial release of `@skillsregistry/dag` from this monorepo.

Ports the package that previously lived at
`~/work/cogniumhq/skillsregistry/packages/dag/` (never published to
npm; consumed via `file:` link inside the mothership repo). This
release is `1.0.0` on npm and closes the SDK publishing decision
tracked in the mothership as workstream #4.

Changes vs the mothership source:

- License changed from `MIT` → `Apache-2.0` to match the rest of the
  `@skillsregistry/*` scope. Was never publicly published under MIT.
- Repository / homepage / bugs URLs updated to `skillsregistry-local`.
- `NOTICE` file added per Apache-2.0 convention.

All 74 tests (`schema.test.ts`, `layers.test.ts`, `resolve.test.ts`,
`validate.test.ts`) pass unchanged.
