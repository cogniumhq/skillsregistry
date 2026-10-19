#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const reportPath = process.argv[2] ?? "cognium-results.json";
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const extraLabel = process.env.INTAKE_LABEL || "";
const MAX_NEW = 5;

if (!repo || !token) {
  console.error("GITHUB_REPOSITORY and GH_TOKEN are required");
  process.exit(1);
}
if (!existsSync(reportPath)) {
  console.error(`Missing ${reportPath}`);
  process.exit(1);
}

const [owner, name] = repo.split("/");
const report = JSON.parse(await readFile(reportPath, "utf8"));
const groups = new Map();

for (const file of report.results ?? []) {
  for (const finding of file.vulnerabilities ?? []) {
    const rule = String(finding.type ?? "finding");
    const path = String(file.file ?? "unknown");
    const key = `${rule}:${path}`;
    const row = {
      rule,
      path,
      line: finding.line ?? "?",
      severity: finding.severity ?? "high",
      message: String(finding.message ?? "").replace(/\s+/g, " ").slice(0, 400),
    };
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
}

console.log(`finding-intake: ${groups.size} per-file rule/file group(s)`);
if (groups.size === 0) process.exit(0);

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "finding-intake",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

let created = 0;
for (const [key, rows] of groups) {
  const marker = `<!-- finding-intake:${key} -->`;
  const q = `repo:${owner}/${name} is:issue is:open in:body "${marker}"`;
  const found = await gh("GET", `/search/issues?q=${encodeURIComponent(q)}&per_page=1`);
  const existing = found.items?.[0];
  const sample = rows[0];
  const lines = rows.map((r) => `- ${r.severity} \`${r.path}:${r.line}\` ${r.message}`).join("\n");
  const body = [
    marker,
    "",
    "Per-file high/critical finding from the scheduled cognium-dev scan of `main`.",
    "",
    lines,
  ].join("\n");

  if (existing) {
    await gh("POST", `/repos/${owner}/${name}/issues/${existing.number}/comments`, { body });
    continue;
  }
  if (created >= MAX_NEW) continue;
  const issue = await gh("POST", `/repos/${owner}/${name}/issues`, {
    title: `SAST: ${sample.rule} in ${sample.path}`,
    body,
    labels: extraLabel ? [extraLabel] : [],
  });
  created += 1;
  console.log(`opened #${issue.number}`);
}
