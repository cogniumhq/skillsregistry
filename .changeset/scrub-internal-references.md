---
"@skillsregistry/domain": patch
"@skillsregistry/schema": patch
"@skillsregistry/eval": patch
"@skillsregistry/contracts": patch
"@skillsregistry/dag": patch
---

Remove internal infrastructure hostnames and private-repo paths from published
package contents.

Internal hostnames appeared in the domain README and in source comments;
`.specifica/...` paths appeared in several comments and in the
`0025_mcp_invocations.sql` migration header. All are replaced with
neutral wording.

No API, type, runtime default or behaviour changes — every occurrence was a
comment, a README line, or a test URL, never a functional default. This is a
patch only because these packages publish `README.md` (and, for schema, the
`.sql` file) inside the tarball, so the artifact contents genuinely differ.
