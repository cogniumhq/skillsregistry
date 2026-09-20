#!/usr/bin/env node
// Validate that every publishable @skillsregistry/* package can be packed
// and that package.json entrypoints (exports / main / types / bin) resolve
// to files that exist after `pnpm build`.
//
// Skips private packages (@skillsregistry/local, @skillsregistry/local-web).
// Usage: pnpm pack:dry-run   (run after pnpm build)

import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(root, "packages");
const SKIP_NAMES = new Set([
  "@skillsregistry/local",
  "@skillsregistry/local-web",
]);

const collectEntrypoints = (pkg) => {
  const paths = new Set();
  const add = (value) => {
    if (typeof value === "string" && !value.includes("*")) {
      paths.add(value);
    }
  };

  add(pkg.main);
  add(pkg.module);
  add(pkg.types);
  add(pkg.typings);

  if (typeof pkg.bin === "string") {
    add(pkg.bin);
  } else if (pkg.bin && typeof pkg.bin === "object") {
    for (const value of Object.values(pkg.bin)) add(value);
  }

  const walkExports = (exp) => {
    if (!exp) return;
    if (typeof exp === "string") {
      if (exp.includes("*")) {
        const dir = exp.replace(/\/\*$/, "").replace(/\/\*\*\/\*$/, "");
        paths.add(`${dir}/`);
        return;
      }
      add(exp);
      return;
    }
    if (typeof exp === "object") {
      for (const value of Object.values(exp)) walkExports(value);
    }
  };
  walkExports(pkg.exports);

  return [...paths];
};

const dirs = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const errors = [];

for (const dir of dirs) {
  const pkgDir = join(packagesDir, dir);
  const manifestPath = join(pkgDir, "package.json");
  if (!existsSync(manifestPath)) continue;

  const pkg = JSON.parse(await readFile(manifestPath, "utf8"));
  if (pkg.private === true || SKIP_NAMES.has(pkg.name)) {
    console.log(`skip ${pkg.name ?? dir} (private)`);
    continue;
  }

  console.log(`\n=== ${pkg.name} ===`);

  for (const entry of collectEntrypoints(pkg)) {
    const abs = join(pkgDir, entry);
    const ok = entry.endsWith("/")
      ? existsSync(abs) && statSync(abs).isDirectory()
      : existsSync(abs);
    if (!ok) {
      const msg = `${pkg.name}: missing entrypoint ${entry}`;
      console.error(`  FAIL ${msg}`);
      errors.push(msg);
    } else {
      console.log(`  ok   ${entry}`);
    }
  }

  // pnpm 9's `pack` has no --dry-run; npm pack --dry-run lists the tarball
  // contents without writing a file.
  const pack = spawnSync("npm", ["pack", "--dry-run"], {
    cwd: pkgDir,
    stdio: "inherit",
    encoding: "utf8",
  });
  if (pack.status !== 0) {
    const msg = `${pkg.name}: npm pack --dry-run exited ${pack.status}`;
    console.error(`  FAIL ${msg}`);
    errors.push(msg);
  } else {
    console.log(`  ok   npm pack --dry-run`);
  }
}

if (errors.length > 0) {
  console.error(`\nSDK pack dry-run failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log("\nAll publishable @skillsregistry/* packages packed cleanly.");
