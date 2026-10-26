# sr-publish

Publish skills to [SkillsRegistry](https://skillsregistry.net) as a verified publisher. Single file, no dependencies, Node ≥ 20.

```sh
curl -fsSLO https://raw.githubusercontent.com/cogniumhq/skillsregistry/main/tools/sr-publish.mjs
node sr-publish.mjs login --out my-key.json          # GitHub device code → key issued to gh:<you>
node sr-publish.mjs publish --key-file my-key.json --body-file skill.json
```

- `login` generates an Ed25519 key **on your machine**. The registry only sees the public key and a signature over a one-time challenge. Your GitHub account needs two-factor authentication.
- New skills are listed as **pending trust** until the registry's scan finishes. You cannot set trust scores, badges or `source` yourself.
- **Lost key:** run `node sr-publish.mjs retire --key-id pk_…`, then `login` again. Skills you already published stay verified.
- `whoami` lists your keys. `request` makes signed changes to a skill you own, such as status, scope or bundle.

Full guide: https://skillsregistry.net/publish

`golden-vectors.json` holds byte-exact canonical forms produced by the registry's own code. `sr-publish.test.mjs` pins this tool to them. If you port the tool to another language, port those tests too: any drift is rejected as `bad_sig`.
