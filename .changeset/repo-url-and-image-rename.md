---
"@skillsregistry/contracts": patch
"@skillsregistry/domain": patch
"@skillsregistry/schema": patch
"@skillsregistry/eval": patch
"@skillsregistry/dag": patch
"@skillsregistry/mcp": patch
---

Point `repository`, `homepage` and `bugs` at `cogniumhq/skillsregistry`.

All six packages carried `cogniumhq/skillsregistry-local` — the repo's name
before it was renamed. GitHub 301s it so the links resolve, but every package
page on npm displayed the old name, and the redirect is not a guarantee.

Patch because this is published metadata: the URLs live in the tarball, so the
correction only reaches npm on the next release.
