# Security Policy

This policy covers the open-source SkillsRegistry SDK and local node published
by Cognium Labs Inc.

## Supported versions

Security fixes are developed on `main` and published for affected artifacts:

| Artifact | Security fix policy |
|---|---|
| Current published version of each `@skillsregistry/*` SDK package | Publish a corrected version if that package is affected |
| Current published `ghcr.io/cogniumhq/skillsregistry-local` image | Publish a corrected image if the local node is affected |
| Older package and image versions | No backports |

SDK packages are versioned independently (`@skillsregistry/<package>@<version>`).
Local-node source tags use `v<version>`, while the published image tags omit
the `v` (`:<version>`). The image's `:latest` tag can move; please include an
exact version or digest when reporting a problem.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Report privately to Cognium Labs at **security@cognium.net**. If you want
end-to-end encryption, request our PGP key at that address before sending
vulnerability details.

Include, as much as you can:

- Affected package and exact version, or local-node image tag or digest
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
  (`ghcr.io/cogniumhq/skillsregistry-local`)
- Repository-maintained installation and discovery metadata, plus release
  tooling and CI workflows in this repo
- Third-party dependency vulnerabilities that are exploitable through a
  SkillsRegistry package or the local node

**Out of scope:**

- The hosted SkillsRegistry service (`skillsregistry.net` and
  `api.skillsregistry.net`, including its public MCP endpoint) uses a
  separate codebase. Report its vulnerabilities to the same address; we will
  route them internally.
- Generic upstream dependency advisories without demonstrated impact on
  SkillsRegistry; please report those to the upstream maintainer.
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
