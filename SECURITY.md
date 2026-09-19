# Security Policy

## Supported versions

This project is in **MVP / pre-alpha**. Only the latest `main` and the
most recent tagged release receive security fixes. Older tags are not
patched.

Once a stable line ships, this table will be updated with the
supported range.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Report privately to **security@cognium.net**. If you want end-to-end
encryption, request our PGP key at the same address and we'll reply
with it.

Include, as much as you can:

- Affected package(s) and version(s) — e.g., `@skillsregistry/domain@1.0.3`
  or `ghcr.io/cogniumhq/skillsregistry:1.1.0`
- Reproduction steps or a proof-of-concept
- Impact assessment (data exposure, RCE, DoS, auth bypass, etc.)
- Your name / handle if you'd like credit in the advisory

## What to expect

- **Acknowledgement**: within 3 business days of receipt.
- **Triage**: initial severity assessment within 7 business days.
- **Fix + advisory**: coordinated disclosure with a **90-day embargo**
  from the acknowledgement date. If we need longer we will tell you why
  and negotiate an extension in writing.
- **Credit**: reporters who follow this policy are credited in the
  published advisory unless they ask to remain anonymous.

If we accept a report and ship a fix, we will publish a GitHub Security
Advisory tagged with a CVE identifier where appropriate.

## Scope

**In scope:**

- Any package in `packages/*` published as `@skillsregistry/*` on npm
- The local app in `apps/local` and its Docker image
  (`ghcr.io/cogniumhq/skillsregistry`)
- Supply-chain issues introduced by our own tooling (release pipeline,
  CI workflows in this repo)

**Out of scope:**

- The mothership (`api.skillsregistry.net`) — that codebase is
  proprietary and handled separately. Report mothership issues to the
  same address; we'll route internally.
- Third-party dependencies unless the issue is our misuse of them.
- Denial-of-service via unrealistic resource limits on a
  self-hosted install (e.g., "if I ingest a billion skills my Postgres
  falls over").
- Social engineering, physical attacks, and anything requiring prior
  compromise of the operator's infrastructure.

## Safe harbor

If you make a good-faith effort to comply with this policy, we will
not pursue legal action against you for the research. Please:

- Give us reasonable time to remediate before public disclosure.
- Avoid privacy violations, data destruction, and service disruption.
- Only interact with accounts and data you own or have explicit
  permission to test.

Thank you for helping keep the ecosystem safe.
