import { readFile } from "node:fs/promises";
import process from "node:process";

const endpoint = "https://api.skillsregistry.net/mcp";
const expectedTools = [
  "fetch",
  "get_skill",
  "get_trust_breakdown",
  "list_leaderboard",
  "resolve_composition",
  "search",
  "search_skills",
];

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const [cursorManifest, claudeManifest, cursorMcp, claudeMcp, registry] =
  await Promise.all([
    readJson(".cursor-plugin/plugin.json"),
    readJson(".claude-plugin/plugin.json"),
    readJson("mcp.json"),
    readJson(".mcp.json"),
    readJson("server.json"),
  ]);

const localErrors = [];
const requireEqual = (label, actual, expected) => {
  if (actual !== expected) {
    localErrors.push(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
};

requireEqual("Cursor plugin name", cursorManifest.name, "skillsregistry");
requireEqual("Claude plugin name", claudeManifest.name, "skillsregistry");
requireEqual(
  "Cursor endpoint",
  cursorMcp.mcpServers?.skillsregistry?.url,
  endpoint,
);
requireEqual(
  "Claude endpoint",
  claudeMcp.mcpServers?.skillsregistry?.url,
  endpoint,
);
requireEqual("Registry remote", registry.remotes?.[0]?.url, endpoint);
requireEqual(
  "Registry repository",
  registry.repository?.url,
  "https://github.com/cogniumhq/skillsregistry",
);

if (localErrors.length > 0) {
  throw new Error(`Listing manifest validation failed:\n- ${localErrors.join("\n- ")}`);
}

const registryValidationResponse = await fetch(
  "https://registry.modelcontextprotocol.io/v0.1/validate",
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(registry),
  },
);

if (!registryValidationResponse.ok) {
  throw new Error(
    `Official registry validation failed: ${registryValidationResponse.status} ${await registryValidationResponse.text()}`,
  );
}

const registryValidation = await registryValidationResponse.json();
if (!registryValidation.valid) {
  throw new Error(
    `Official registry rejected server.json: ${JSON.stringify(registryValidation.issues ?? [])}`,
  );
}

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {
        name: "skillsregistry-listing-validator",
        version: "1.0.0",
      },
    },
  }),
});

if (!response.ok) {
  throw new Error(
    `MCP initialize failed: ${response.status} ${response.statusText}`,
  );
}

const initialize = await response.json();
requireEqual(
  "Negotiated protocol",
  initialize.result?.protocolVersion,
  "2025-06-18",
);

const toolsResponse = await fetch(endpoint, {
  method: "POST",
  headers: {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  }),
});

if (!toolsResponse.ok) {
  throw new Error(
    `MCP tools/list failed: ${toolsResponse.status} ${toolsResponse.statusText}`,
  );
}

const toolsPayload = await toolsResponse.json();
const actualTools = (toolsPayload.result?.tools ?? [])
  .map((tool) => tool.name)
  .sort();

if (JSON.stringify(actualTools) !== JSON.stringify(expectedTools)) {
  localErrors.push(
    `Tool names: expected ${expectedTools.join(", ")}, got ${actualTools.join(", ")}`,
  );
}

requireEqual(
  "Registry version",
  registry.version,
  initialize.result?.serverInfo?.version,
);

if (localErrors.length > 0) {
  throw new Error(`Production listing validation failed:\n- ${localErrors.join("\n- ")}`);
}

console.log(
  `Official registry accepted server.json; listing manifests match ${initialize.result.serverInfo.name} ${initialize.result.serverInfo.version}; ${actualTools.length} tools available without authentication.`,
);
