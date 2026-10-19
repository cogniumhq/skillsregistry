---
"@skillsregistry/domain": patch
---

`normalizeRepositoryUrl` now canonicalizes `ssh://` and `git+ssh://` clone URLs to the same `host/path` key as `https://` and `git@host:path` forms so search dedupe does not split one repository across identities.
