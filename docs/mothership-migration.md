# SDK extraction / mothership migration

The detailed playbook for consuming `@skillsregistry/*` from npm in the
hosted service lives in the **private mothership repo**. This public tree
does not carry mothership-internal filenames, hostnames, deploy steps, or
catalog snapshots.

## What this repo publishes

This repository is the open-source half: SDK packages under `@skillsregistry/*`
and the self-hosted local node. The hosted catalog at `api.skillsregistry.net`
consumes the published npm packages.

## High-level checklist (mothership-side)

Do this work in a mothership-repo session, not here:

1. Confirm the intended `@skillsregistry/*` versions exist on npm.
2. Switch mothership dependencies from local path links to those published versions.
3. Remove any remaining inlined copies of extracted modules.
4. Rewire imports to the package names and bind runtime adapters at boot.
5. Typecheck, run the mothership test suite, and run the eval/smoke gates
   defined in the mothership tracker before deploy.
6. If a port-shape mismatch appears, open an issue on this public repo
   describing the missing surface — do not fork the port shape on the
   mothership.

Do not copy mothership-internal runbooks into this tree.

---

*Cognium Labs · 2026*
