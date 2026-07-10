// ══════════════════════════════════════════════════════════════════════════════
// Eval Fixtures — Query/Skill Test Pairs (Phase 2)
// ══════════════════════════════════════════════════════════════════════════════
//
// 90+ pairs across all 5 phrasing patterns + disambiguation + near-miss.
// Phase 2 expands from 7 skills / 32 queries to 40 skills / 90+ queries.
//
// Pattern definitions:
// - direct: User knows exactly what they want
// - problem: User describes their problem, not the solution
// - business: Non-technical/PM language
// - alternate: Different terminology for same concept
// - composition: Part of a larger workflow
//
// ══════════════════════════════════════════════════════════════════════════════

// EvalFixture type defined below (was in mothership src/types.ts prior to
// the T-1.6 extraction). Kept co-located with the fixtures + validators so
// consumers only need `@skillsregistry/eval`.

export interface EvalFixture {
  id: string;
  query: string;
  expectedSkillId: string;
  /** Additional IDs that count as correct (cross-source duplicates). */
  acceptableSkillIds?: readonly string[];
  /** Name substrings that auto-match (e.g. 'prometheus' matches any Prometheus MCP server). */
  acceptableNamePatterns?: readonly string[];
  pattern: 'direct' | 'problem' | 'business' | 'alternate' | 'composition';
}

// Skill ID constants for readability
const SKILL = {
  CARGO_DENY: '550e8400-e29b-41d4-a716-446655440001',
  PRETTIER: '550e8400-e29b-41d4-a716-446655440002',
  ESLINT: '550e8400-e29b-41d4-a716-446655440003',
  TRIVY: '550e8400-e29b-41d4-a716-446655440004',
  DOCKER_POSTGRES: '550e8400-e29b-41d4-a716-446655440005',
  PANDOC: '550e8400-e29b-41d4-a716-446655440006',
  REDIS: '550e8400-e29b-41d4-a716-446655440007',
  LICENSE_CHECKER: '550e8400-e29b-41d4-a716-446655440008',
  FOSSA: '550e8400-e29b-41d4-a716-446655440009',
  BIOME: '550e8400-e29b-41d4-a716-446655440010',
  BLACK: '550e8400-e29b-41d4-a716-446655440011',
  SEMGREP: '550e8400-e29b-41d4-a716-446655440012',
  SNYK: '550e8400-e29b-41d4-a716-446655440013',
  CODEQL: '550e8400-e29b-41d4-a716-446655440014',
  DOCKER_BUILD: '550e8400-e29b-41d4-a716-446655440015',
  DOCKERFILE_LINT: '550e8400-e29b-41d4-a716-446655440016',
  HADOLINT: '550e8400-e29b-41d4-a716-446655440017',
  POSTMAN: '550e8400-e29b-41d4-a716-446655440018',
  HTTPIE: '550e8400-e29b-41d4-a716-446655440019',
  REST_CLIENT: '550e8400-e29b-41d4-a716-446655440020',
  TERRAFORM: '550e8400-e29b-41d4-a716-446655440021',
  KUBECTL: '550e8400-e29b-41d4-a716-446655440022',
  CLOUDFLARE_DEPLOY: '550e8400-e29b-41d4-a716-446655440023',
  PROMETHEUS: '550e8400-e29b-41d4-a716-446655440024',
  GRAFANA: '550e8400-e29b-41d4-a716-446655440025',
  DATADOG: '550e8400-e29b-41d4-a716-446655440026',
  MYSQL: '550e8400-e29b-41d4-a716-446655440027',
  MONGODB: '550e8400-e29b-41d4-a716-446655440028',
  DRIZZLE_MIGRATE: '550e8400-e29b-41d4-a716-446655440029',
  GIT_HOOKS: '550e8400-e29b-41d4-a716-446655440030',
  COMMITLINT: '550e8400-e29b-41d4-a716-446655440031',
  SEMANTIC_RELEASE: '550e8400-e29b-41d4-a716-446655440032',
  TYPEDOC: '550e8400-e29b-41d4-a716-446655440033',
  STORYBOOK: '550e8400-e29b-41d4-a716-446655440034',
  SWAGGER_CODEGEN: '550e8400-e29b-41d4-a716-446655440035',
  JEST: '550e8400-e29b-41d4-a716-446655440036',
  PLAYWRIGHT: '550e8400-e29b-41d4-a716-446655440037',
  K6: '550e8400-e29b-41d4-a716-446655440038',
  CLIPPY: '550e8400-e29b-41d4-a716-446655440039',
  DEPENDABOT: '550e8400-e29b-41d4-a716-446655440040',
} as const;

/** Canonical eval skill UUIDs keyed by fixture constant name. */
export const evalCanonicalSkillIds = SKILL;

// Acceptable alternative skill IDs — cross-source duplicates and equivalent tools
// that serve the same purpose as the primary expected skill.
const ALT = {
  POSTGRES: [
    'c6d7bda7-07f2-4cb9-a00e-4ad10a2ab08a', // capital.hove/read-only-local-postgres-mcp-server
    'b5d83ffb-ba08-4574-8fc5-b2f5fe41a0a6', // PostgreSQL MCP Server (neverinfamous)
    '81981fae-8a78-45c3-aa3b-ee5ef583179c', // PostgreSQL MCP Server (itunified)
    '73c8dce1-8827-4db7-a54a-601f376481f0', // PostgreSQL MCP Server (neverinfamous-server)
    '8c931f75-4fcd-4dba-a501-37c9aa8e1a45', // io.github.pgEdge/postgres-mcp
    '2ca2c400-3b4d-43b2-99e3-16f5934ff0ba', // ai.waystation/postgres
  ],
  PANDOC: [
    'f4b1fc72-1fbc-4736-b7ac-97ed6b382086', // MCP MD2PDF Server
    '647b7fad-d16f-4276-8f5a-b81255d9927f', // Pandoc Document Conversion (glama)
    'cb763396-af0d-4ffc-95d5-9e59d304d094', // mcp-pandoc (glama)
    '841a5be0-b1d0-433a-a75e-04d2251eebb5', // huoshui-pdf-converter
    '42779b73-f9ff-40aa-8328-c4d0ebd99b51', // Prince PDF Converter
    '0882ec8c-dd16-4ee0-bca8-7ab2cd8b4599', // PDFCrowd PDF Export
  ],
  TERRAFORM: [
    '5f3bf9fe-7933-42a1-b355-351e817fd1f4', // Terraform (hashicorp MCP server)
    'ae0d726d-6cc6-4f0e-a77a-71241240ef4d', // F5 Distributed Cloud Terraform Provider
    '3975e73b-4159-4d27-a2cd-0f2494c77d08', // Terraform Ingest MCP
    '66bfd735-f71c-473e-a191-1fb52946871b', // Terraform Registry MCP Server
  ],
  PROMETHEUS: [
    '122724ed-ecd1-4bb3-900c-d950f5d6ca34', // io.github.mshegolev/prometheus-mcp
    '93ec1114-5607-423a-9a23-4629aa3910e4', // io.github.tjhop/prometheus-mcp-server
    '10831dd6-b6a5-4d5f-a1b8-82ad4c3dc3db', // Prometheus MCP Server (pab1it0)
    '7fa0db34-b200-45b7-a304-1c669fa67291', // io.github.jeanlopezxyz/mcp-prometheus
    '5ab0206a-01bd-466e-8781-2b104bce0a4a', // Prometheus MCP
    'fd419bc0-fde7-4b58-bbf4-2873251c9acc', // Prometheus MCP Server (glama)
    'ae9dd9fb-b48b-4ae7-999b-dffa83886946', // OpenTelemetry MCP Server
    '5f8a5cbc-ff09-4db8-aaac-70e933b3cb6f', // Prometheus (alt source)
  ],
  PLAYWRIGHT: [
    'ced13a07-eab5-4b99-b93e-433c1d47d57b', // Playwright Automation (microsoft-playwright-mcp, smithery)
    '1ab5fd33-49cd-4dfa-89b2-918cc7e2f52c', // io.github.dinesh-nalla-se/playwright-mcp
    '910b2f97-7538-4e24-b3ec-439b2d8dc92a', // io.github.oguzc/playwright-wizard-mcp
    'b8d5dd0e-5497-4300-8c72-d8ba88e2883e', // Playwright (glama)
    '840896fc-a3fb-4dbe-be5b-cff255071b91', // Cloudflare Playwright MCP
    '307c288b-3439-49dd-90ed-871e9f638bee', // MCP Playwright Server
  ],
  GRAFANA: [
    '4c6cfb76-62f0-4612-a2a5-75f346fcabc5', // io.github.grafana/mcp-grafana
    'e7f80c6b-72a7-42e7-b8a8-f2ffa52225ae', // Grafana (glama)
    'bbabea4a-f123-4acc-b4a5-84099e38501e', // Grafana MCP Server (drdroidlab)
    '1c7e22e2-4900-4e9f-9027-35d79980c1fc', // Grafana MCP Server (0xteamhq)
  ],
  SEMGREP: [
    'c8570524-c718-4edb-80d5-8eff99238f59', // Semgrep MCP Server (glama)
    '7955d13d-502b-4d34-a7d3-4158dad578b9', // MCP Server Semgrep (glama)
    '7fb74cce-a81a-47f4-9efd-e5af648ceb76', // Semgrep MCP Server (stefanskiasan)
  ],
  POSTMAN: [
    '38e417ec-f042-434c-b284-bf4b84caf722', // io.github.cocaxcode/api-testing-mcp
    'e04a75f4-f16f-402b-8b70-8053bc5ac93c', // io.github.ryudi84/api-tester
    '0cfe47bc-a59b-4b62-9969-8a4300d26a58', // MyPostmanServer (glama)
    'c2033721-020a-4ce3-8906-dbb5fda1589c', // Postman MCP Server
    '1ba47d16-154f-4434-aa66-9a331a7abf58', // api-test-mcp
    '84fc6df9-982b-4bb0-9afa-fab18e63b7c0', // newman (Postman CLI runner)
    'ee56dfee-92e8-4d48-b002-e69323f6257b', // API Tester (pulsemcp)
    '20118977-6c68-4c4e-9493-43a5ca2dd67a', // com.postman/postman-mcp-server
  ],
  CLOUDFLARE: [
    '1d787498-ded2-4a51-b1e5-ba540e3cb804', // cloudflare-mcp (github)
    'cba11189-cb90-4d60-bcdc-eb4dfde01a30', // Cloudflare (smithery)
    '75a6496b-1867-4b9e-957f-5b350ebc9b9e', // com.cloudflare.mcp/mcp
    'b5d5365e-2e24-4952-b5b4-df75de224fad', // Cloudflare MCP Server (itunified)
  ],
  REDIS: [
    'aa4e77f6-807c-4fef-b460-c8cad905648f', // Redis MCP Server (official redis)
    'f2c4fe73-d2b8-42ab-a33c-b0dcae737437', // io.github.daedalus/mcp-redis-server
    '8f16bf78-6516-4425-adc7-ff09ec165b81', // mcp-redis (redis official)
  ],
  LICENSE: [
    '99e1a1a1-6627-473e-8b3e-111d2e4606a5', // io.github.bighippoman/license-compliance
    '34813153-20c9-43cc-8de6-181d6c7ab4c8', // io.github.webmoleai/mcp-check-licenses
    '0b4826ed-10ee-49ce-b741-edf55cb8484f', // io.github.webmoleai/mcp-license-audit
    '53072956-6ecc-493e-9463-5784c22b9188', // io.github.thegridwork/license
    '63ab7614-847f-4247-9861-a89dbd65ec75', // license-checker-ai-mcp
  ],
  KUBECTL: [
    '5e464e5e-bdef-4fda-b016-0ff285cbbdcc', // io.github.containers/kubernetes-mcp-server
    '3848bab1-fe87-461e-b44d-933568c39ccc', // Kubernetes Monitor
    'a746a0c1-04a6-4cc3-81a9-f69974b94f99', // kubectl-mcp-server
    '7c7a366f-6a9c-4a09-b50e-7a4832f2fd2d', // kubectl-debug-queries
    '4a63f6e4-a670-4294-ba6a-62cafe3edb45', // mcp-k8s
    'fd07949e-89f1-4830-bda5-c535e7fe1ea6', // K8s MCP
    'b5ce29da-5ca7-49b5-8d66-4dc4e53a0d92', // mcp-server-kubernetes
    '3cfa9108-723e-451a-a507-909f7ad5c3e0', // K8s Doctor MCP
    '9ad31284-99c1-4228-9097-99835b82b14e', // Kubernetes MCP Server
    'b4eb3589-1491-44cc-80e8-923815523410', // kube-MCP
    'fe7ee2ee-aa5d-4955-9c6b-bd93f338a3cb', // kubernetes-mcp
    '37d45443-157a-44c2-b1b9-e2b299186eca', // k8s-interactive-mcp
    'b7b599e5-b73e-41f3-a59b-8ff3baf765ed', // kube-lint-mcp
    'facd248d-9341-4732-bb73-799c3032e137', // Rootcause (K8s crash debugging)
    '3945936d-92f3-4081-99da-2af80ef2b814', // mcp-k8s-ro (k8s read-only)
  ],
  TRIVY: [
    '49202c54-6431-4e13-8ecb-9ef633e41812', // Trivy (glama)
    '0006c23e-ea0f-4554-bd53-a2f0045b36e7', // Trivy Security Scanner MCP Server (glama)
  ],
  SNYK: [
    '02a50a22-b9ad-4e24-90dd-f9375267fe1a', // io.snyk/mcp
    '56c5399c-9db8-4e98-bfaa-69613eb2fab4', // Snyk MCP Server (glama)
    'f4194e58-6c52-4cce-8734-5538a695bd71', // Snyk Studio MCP (glama)
    'e95e8b1e-4fd3-4cbf-bf5a-47527b21e5c6', // depguard (SCA tool)
  ],
  DATADOG: [
    '8384396f-37c4-4fb3-9f64-ae5531e0c9fb', // New Relic MCP Server
    '06775d9e-2da6-4aed-847f-70aa31b95c9a', // mcp-datadog
    '1742f2ff-3c6f-4a9c-86a8-bc523b538cca', // io.github.TANTIOPE/datadog-mcp
    'f91a44f1-664b-4820-ae51-d16d3e7d566d', // New Relic MCP Server (different source)
    '22707669-13cf-45d6-9d78-ab2f51236394', // Datadog MCP Server
  ],
  JEST: [
    'cfe33e8b-3bac-42e5-a735-5b577ddfd46e', // Claude Jester MCP (test runner)
  ],
  ESLINT: [
    '473631aa-741c-4913-b491-c4c1c75d45af', // oxlint-mcp (JS/TS linter)
    '141818e4-9019-4c8e-979d-1043eb5a8112', // pare-lint (ESLint/Prettier/Biome/Oxlint wrapper)
  ],
  COMMITLINT: [
    'e2b85bd4-e607-4140-9f59-6373980fb280', // conventional-commits
    '1b62ca2d-799a-4473-9adb-e5ecdfb761a9', // commit-message-ai-mcp
    'f62dc3ca-9697-48fc-860a-d5e839877c80', // Commit Conventional Message Court
  ],
  SEMANTIC_RELEASE: [
    '330d6156-2ee8-49c5-a48e-0ab212a68064', // io.github.ryudi84/changelog
    '6dadfec6-76f1-48c0-b131-dd0fb8d14467', // io.github.ryudi84/changelog-forge-mcp
    '54e02817-8a5f-4cbb-8557-7368d8e6e5c6', // changelogai
  ],
  SWAGGER: [
    'e35a2840-888f-4992-bf73-a3a5ad1a8387', // io.github.Docat0209/openapi
    '5e29a57e-9b66-441c-b0bc-75b1f973d045', // OpenAPI to MCP
    'b028293c-9f21-4c90-8cc9-0ee3db09ee17', // OpenAPI MCP Server
    'b9553847-9980-47bd-b8a1-fef70ce19559', // MCP Swagger Server (glama)
  ],
  DEPENDABOT: [
    'e95e8b1e-4fd3-4cbf-bf5a-47527b21e5c6', // depguard
    '5bd7aa91-6aee-42dc-9ac2-6d7da3654c1a', // io.github.niradler/dependency-mcp
    '42826fc0-2bad-4a54-b3c8-2233139261ec', // com.sonatype/dependency-management-mcp-server
    'f517e107-f7e5-40d1-8f90-661912b78a68', // dependency-audit
  ],
  STORYBOOK: [
    'cd92cdca-8e61-423e-84ab-8d75db53f34e', // Storybook MCP Addon
    'e8486b85-ed6d-427e-bc1a-f31d3000a654', // storybook-mcp-server (ansariwaqqas)
  ],
  FOSSA: [
    ...[] as string[], // fossa has few direct alternatives; license tools overlap
  ],
  K6: [
    '89cce5f0-767a-43fa-a429-fc8b596f0f0b', // jmeter-mcp (load testing)
  ],
  CODEQL: [
    'e9684f45-707d-433a-a4c4-a4d65a210b11', // Grasp — Codebase Analysis
    'b0ee7e53-e1cd-4fe3-989a-48fde7612678', // Joern MCP Server (SAST)
    '2eb2991d-f2fc-4729-9037-2845fc720d7e', // code-sentinel (code quality/security analysis)
  ],
  MONGODB: [
    'afde2c53-12bb-4272-9bb3-bf1a82f39745', // Lindorm MCP Server (NoSQL)
    '32d51cf6-687e-4fe4-93dd-fbeef8dde16c', // Couchbase MCP Server (NoSQL)
    '803605ad-c17d-4fac-a644-570488d038a9', // Azure Cosmos DB MCP Server (NoSQL)
    'f7b168fd-4c38-45a8-b833-a04628626aa1', // Couchbase (pulsemcp)
    '23e9a0d7-3530-45e2-8b99-932d9fdea31b', // MongoDB MCP Server (pulsemcp)
    '7a077718-7a5e-42c7-8616-0595e30b73fb', // ArangoDB (NoSQL document database)
  ],
  SECURITY_ANALYSIS: [
    '37622379-21d9-420a-b528-0d2bc49864f1', // security-checker
    '9e0761bf-92ed-4d95-bf1a-288c10f85429', // Bug Detector (code analysis)
    '4bf19a51-8178-4a0e-9c6b-4fb1364ff9dd', // lenses (multi-lens code review)
    'b0ee7e53-e1cd-4fe3-989a-48fde7612678', // Joern MCP Server (SAST)
    '2eb2991d-f2fc-4729-9037-2845fc720d7e', // code-sentinel (security analysis)
    '40343933-2809-4b5e-8c58-ceae83977cfc', // CodeBadger Toolkit (static analysis via Joern)
    '665c2790-3351-42d6-abe7-746eaf570c0a', // Sheriff (SARIF static analysis)
    '5271235b-fdbb-4708-8ffd-9cfc49631f04', // claude-code-safety-net (code security)
    'c5313718-8861-454b-a52e-284b35978892', // Code Review Analyst (security review)
  ],
  MONITORING: [
    '3951b9af-123e-4adb-9faa-63aac2914f4d', // AppSignal MCP (monitoring)
    '27134267-2505-43ff-90ac-7a0adb2e44e6', // Observability MCP Server
    '44db5eb6-b4b2-4624-9049-b84f84f38033', // mcp-observability-server
    'cf9547c1-a82e-4ac3-b101-1d8fc69686da', // Fulcra Context (health monitoring)
    '73ef9110-b43a-407c-9e20-26dfe0654114', // mpop (application performance monitoring)
    '0e646a51-32ff-4707-9ef4-4f4236568728', // Alpic (monitoring stack)
    '360e9461-1e5f-4f42-848e-831e118fe467', // honeycomb-mcp-server (observability)
    'd2b7034d-85d8-4d2b-8469-105c7543a081', // Cloudflare DEX (digital experience monitoring)
    '7eb78d28-223d-4e8b-a197-ad8e1109294c', // Seq MCP Server (structured log monitoring)
    'e17333c8-be18-4c0d-8a2e-426d81c0f463', // Splunk MCP Server (log/metrics monitoring)
    '4994161d-6cbf-4d4f-b791-6867e988de13', // Node.js MCP Server (mustafa-can-mcpserver)
    'b674913c-901e-4a96-84e9-60e62ad30bfb', // Context Guardian (cloud context monitoring)
    '4b3a690c-df68-4886-b981-ca138767e002', // Red Hat Status MCP Server (uptime monitoring)
    '4bc880fd-62a0-4a0b-81cc-eaafe3c43377', // Logaflow (log/metrics monitoring)
  ],
  CODE_QUALITY: [
    '88258393-d923-4d93-8c8b-a4762294912c', // code-quality (complexity, duplicates, naming)
    '9e0761bf-92ed-4d95-bf1a-288c10f85429', // Bug Detector
    '85ee5b6f-d2a6-4a66-8c0b-117e71bbc748', // mcp-sonarqube (code quality CI)
    'f355c2ce-e3cb-46fd-94bd-88e615989ba1', // CodeSherlock (code analysis)
    '022ce744-d7a1-49f2-a153-72223cceeb7b', // nextscan (Next.js scanner)
    '977c8d70-3ecf-4237-a492-30f155692078', // vet (code vetting)
    'b1745fe7-0304-4055-a8a1-b6c300f3604b', // Apiiro Guardian Agent (code security)
    '656b2312-aab4-47c6-a0e6-979b1cdbc700', // Roslyn CodeLens (code quality)
    '588da5c8-a4f9-4444-83b8-e856a09e36a9', // typescript-lsp (code analysis)
    'd435fd2d-0c35-4ddd-a3d8-5858c439b3c3', // Code Assistant (code review/issues)
    '6dfdbb36-cbb8-43eb-b984-96e61a7eb7b1', // Bug Detector (pulsemcp)
    'c5313718-8861-454b-a52e-284b35978892', // Code Review Analyst
    '16814cc7-9794-467f-beac-f2a31cf659aa', // Redux Saga Testing
  ],
  CLOUD_DEPLOY: [
    '6452601e-81c9-4712-863d-5b43607f359b', // heroku-mcp-server
    '3ad22348-51e1-46b1-b6b5-4db1f6608ea6', // azd-deployment (Azure Container Apps)
    'd77bd30c-b653-4922-aae1-504dd4b80525', // ibmcloud
    'bd69c0de-2a87-434c-aa77-9748e11ab3ae', // Railway MCP Server
    '7abf0ea7-3e8a-468b-a282-14809a480bc0', // Template (deploy tool)
    '16517573-5792-4323-9261-bc2cd83c18b9', // terraform-cloud-mcp
    'fa30bfc3-421e-4065-bd1d-fe6bf84018b3', // AppDeploy (application deployment)
    '8d9cfb13-bc35-4bea-80e8-10974ec40724', // Vercel (deployment platform)
  ],
  API_TESTING: [
    'ddf79f9b-bfe1-48fd-aefe-6eb86a270960', // api-tester
    '18563797-9e28-4e2d-8cb2-6e4e4f126f5c', // mcp-rest-api
    '60959bbc-20b9-49c1-8fda-3e5d4a2a609a', // ub2-api-health-checker
    '90fa3c90-c045-4dd6-8dfa-4b91c7cfa7e6', // HTTP Request Testing (pulsemcp)
    'ebb55123-f8e4-46ad-8d66-585ed6ae1603', // ai.smithery/arjunkmrm-http-test
  ],
  FRONTEND_TESTING: [
    '34f5fbc0-f78e-4524-a37d-0ad82d0f411b', // MCP Frontend Testing Server
    '6a79e8de-e633-479f-a674-e0317255960b', // Applitools (visual testing)
    '90cb457b-29f7-487e-b69b-d0c64567f970', // BrowserStack (cross-browser testing)
  ],
  INFRA_AS_CODE: [
    '38dbab7b-d3cb-4842-83fe-f4972422a0ab', // infra-as-code
    '28aae8a6-76eb-47f0-8bd7-d162689baadb', // cloudforge (Terraform HCL + cloud infra)
    'bcaaaaf4-dc84-4951-a618-b6fa5b4f5802', // cloudwright-mcp (IaC from natural language)
    '9e84f6f9-569f-49e6-ac90-2431c4e2c45c', // MCP SysOperator (Ansible/Terraform)
    '8a02ed1c-239f-4d04-9cba-6aac8643e88c', // oracle-cloud (cloud provisioning)
  ],
  DB_MIGRATION: [
    '20cffde8-6cb1-49d8-ad09-e214302faede', // migrationpilot (PostgreSQL migration rules)
    '8dd1c0a0-31d9-423b-9260-153160a68156', // MCP Atlas (database migration management)
    '17a99f59-cb3d-45fc-aeb6-48d9ad36ad69', // MigrationPilot (smithery)
  ],
  CONTAINER_SCANNING: [
    '964c98ee-9cea-4012-ac1a-0f3f493ba36a', // On-Demand Scanning API (Google container scanning)
  ],
  API_DOCS: [
    '6a0d4869-1320-460f-ab57-ef525d2cf714', // FastAPI MCP OpenAPI
    '9e1fabe8-0880-4ee7-bfcd-eb010a7786c9', // Fortnox Doc MCP (API doc generation)
    'ae94bd74-a520-4265-965e-1cc75a95eedd', // sovereign-api-docs-generator
  ],
  DOC_CONVERTER: [
    '125b7b4f-d96e-47bd-8ba5-4241f7f36646', // MarkItDown MCP Server
    '5742ff28-1014-4b7f-a43b-8d88a7c69044', // MCP PDF to Markdown Converter
    'f3a25640-091e-45bf-85f8-e7631cde34e6', // RenderMark (Markdown to PDF/DOCX/HTML)
    'c78b678f-5abd-401a-af78-647ca4f8de0b', // proflulab-documentassistant (document converter)
    '7f1aac23-8ef8-4914-824d-ccf45d157fe5', // huoshui-file-converter
    '652406ad-962b-45b8-b747-56e257abd672', // remove-metadata-from-pdf
    '58c99c8f-4c41-4f50-86ee-d08003e051a4', // mcp-pdf2md (PDF to markdown)
  ],
  CACHE: [
    'a0951745-4301-45a8-a7ef-531407aac85f', // smart-cache (LRU/LFU caching)
    'ef4fb428-c8af-487d-a473-4858310564d3', // Memory Cache (in-memory caching)
  ],
  DEP_SECURITY: [
    'df727e7e-2ca4-4c0b-81a2-398658fae33d', // dependency-updater-ai-mcp
    '68e9d053-13b1-4763-9c53-82f25ba56fb2', // GuardianMCP (npm/Composer vuln scan)
    'f782ec3b-8b62-42af-a0f4-75835eece7b7', // Mcp Security Audit (npm audit)
    'd200df82-dc78-4451-93b9-3ae6b00c2440', // dependency-auditor
    '42826fc0-2bad-4a54-b3c8-2233139261ec', // Sonatype dependency management
    '6a060fed-1261-4c80-bc1f-b941e39bc54f', // dep (dependency manager)
    '6e93c584-78a3-4b78-af8a-f0148313e5ae', // CVE Checker for Node Modules
    'ddbf775e-0944-465f-9592-982582cd6045', // OSV (open source vulnerability database)
    '9c7d8676-8bc5-4356-bef4-30185a4d0cbc', // Hex Graph (dependency analysis)
    '4f3c1dc7-7f65-4729-a6c3-344ee5769c22', // References (Chinese security audit — checks deps, perms, etc.)
    'c3f97a0c-c3a4-4253-b5ad-f74328998a24', // Sx Security Audit (Chinese security audit)
    'a27747ba-8cb7-4ff3-a014-e38a96bae45a', // Socket MCP Server (dependency supply chain security)
    '9196cb95-30aa-4319-bd77-b944c8f4170c', // dep-audit (dependency audit tool)
    '5a1fd58b-383d-453e-bbe8-7459f23176d3', // SBOMApp (SBOM + vulnerability scanner)
    'a19c2398-b7a9-4115-814a-dbccc68759fb', // Dependency Checker (niradler-dependency-checker)
    '480e0b23-09c0-436b-8618-1e97a600cffe', // Dependency Analysis (SCA)
  ],
  MD_TO_PDF: [
    '56844c03-93b6-4885-8046-79f5a70c866f', // MD-PDF MCP Server
    '720b6eac-ff18-444b-90b0-d95fb7acee73', // Markdown2PDF MCP Server
    '962193a6-075e-424b-af6e-3b6167b24dd7', // io.github.wmarceau/md-to-pdf
    '0ebb774e-7469-4bcd-bfd9-fcc041076461', // md-to-pdf-with-mermaid-mcp
  ],
  TS_TOOLS: [
    '9f531d13-b288-4b92-8ee8-7be638f5c9e7', // TypeScript Tools MCP
  ],
  CODE_REVIEW: [
    'd435fd2d-0c35-4ddd-a3d8-5858c439b3c3', // Code Assistant
    '76d7ab97-d514-47af-b206-dcbd571b7a76', // Code Review Analyst
    '96f5858a-98ff-4731-b35e-d04449c80505', // Octocode MCP - AI Context Platform
    '483f0b4e-70e5-4b18-b58c-ca8d0524c371', // GitHub Code Review Assistant
  ],
  BROWSER_DEBUG: [
    '3e99a3d5-6338-4c43-a8da-66f00016d65a', // Chrome Debug MCP Server
    '0fbcaaba-550a-4eab-a7c1-ad9e1e119c4b', // Browser Instrumentation MCP Server
    '7dcc9484-c699-4d68-bc73-d76e79e1cd3e', // Chrome Debug MCP Server (alt)
    'd0eb637c-d114-444d-9316-65ae4fa12218', // Browserbase (browser automation)
    'bc1cc827-1a2e-4960-82ec-2d2a501f1eae', // Better-Auth (login/auth flow)
    '24211068-2996-443c-8ff8-d30cf565b3b2', // SteadyFetch (browser fetch)
    'a6d35954-01da-4d04-9343-71f4e3836b5c', // gateway-guard (auth/login protection)
  ],
  UI_COMPONENTS: [
    'fc2d14d6-6635-4e58-a23a-e9b92730d855', // PrimeNG MCP Server
    'fe62ccd4-8bc1-40c9-83d6-eac327fb09dd', // MUI MCP Server
    '75100b25-979d-4e8f-86eb-7445a8db9491', // shadcn-mcp
    '5cd6f45f-c933-44e2-a7fd-9277575632c6', // 21st.dev Magic AI Agent
    '3141c3b5-aa81-487e-af1f-95a8123c4d46', // Shadcn UI Component Reference Server
    'dfcf5e9c-657d-4dc8-b269-0190e311a810', // Rakit UI AI
  ],
  FORMATTERS: [
    'ab1d003f-1a18-470e-a2be-ec05296d43d3', // Coding Custom (code style consistency)
    '4b3d7860-13a4-4525-9ddf-f618d589642a', // Project Data Standardization MCP
  ],
  DEV_ENVIRONMENT: [
    '83768da8-51ce-40c1-b15b-1dbd2692e8c9', // context-foundry (project context)
    '4a9406f1-92cc-41eb-8c4f-2db74b654aea', // Cloudflare Containers
    '7b6d54db-bf37-4abc-b559-39abd70ebab3', // Template server
    '56484365-d4ff-40c3-a300-bd0d19c4475d', // my-mcp-server
  ],
} as const;

export const evalFixtures: EvalFixture[] = [
  // ──────────────────────────────────────────────────────────────────────────
  // DIRECT Pattern — User knows exactly what they want
  // ──────────────────────────────────────────────────────────────────────────

  { id: 'eval-direct-001', query: 'check rust dependency licenses', expectedSkillId: SKILL.CARGO_DENY, acceptableSkillIds: [SKILL.LICENSE_CHECKER, ...ALT.LICENSE], pattern: 'direct' },
  { id: 'eval-direct-002', query: 'format typescript code', expectedSkillId: SKILL.PRETTIER, acceptableSkillIds: [SKILL.BIOME, ...ALT.TS_TOOLS, SKILL.TYPEDOC], pattern: 'direct' },
  { id: 'eval-direct-003', query: 'lint javascript files', expectedSkillId: SKILL.ESLINT, acceptableSkillIds: [...ALT.ESLINT, SKILL.BIOME], pattern: 'direct' },
  { id: 'eval-direct-004', query: 'scan docker images for vulnerabilities', expectedSkillId: SKILL.TRIVY, pattern: 'direct' },
  { id: 'eval-direct-005', query: 'run postgres database locally', expectedSkillId: SKILL.DOCKER_POSTGRES, acceptableSkillIds: ALT.POSTGRES, pattern: 'direct' },
  { id: 'eval-direct-006', query: 'convert markdown to pdf', expectedSkillId: SKILL.PANDOC, acceptableSkillIds: [...ALT.PANDOC, ...ALT.MD_TO_PDF, ...ALT.DOC_CONVERTER], pattern: 'direct' },
  { id: 'eval-direct-007', query: 'audit npm package licenses', expectedSkillId: SKILL.LICENSE_CHECKER, pattern: 'direct' },
  { id: 'eval-direct-008', query: 'run semgrep static analysis', expectedSkillId: SKILL.SEMGREP, acceptableSkillIds: ALT.SEMGREP, pattern: 'direct' },
  { id: 'eval-direct-009', query: 'build docker image from dockerfile', expectedSkillId: SKILL.DOCKER_BUILD, pattern: 'direct' },
  { id: 'eval-direct-010', query: 'run postman api collection', expectedSkillId: SKILL.POSTMAN, acceptableSkillIds: ALT.POSTMAN, pattern: 'direct' },
  { id: 'eval-direct-011', query: 'deploy terraform infrastructure', expectedSkillId: SKILL.TERRAFORM, acceptableSkillIds: ALT.TERRAFORM, pattern: 'direct' },
  { id: 'eval-direct-012', query: 'set up prometheus metrics', expectedSkillId: SKILL.PROMETHEUS, acceptableSkillIds: ALT.PROMETHEUS, pattern: 'direct' },
  { id: 'eval-direct-013', query: 'run jest unit tests', expectedSkillId: SKILL.JEST, acceptableSkillIds: ALT.JEST, pattern: 'direct' },
  { id: 'eval-direct-014', query: 'run playwright browser tests', expectedSkillId: SKILL.PLAYWRIGHT, acceptableSkillIds: ALT.PLAYWRIGHT, pattern: 'direct' },
  { id: 'eval-direct-015', query: 'deploy to cloudflare workers', expectedSkillId: SKILL.CLOUDFLARE_DEPLOY, acceptableSkillIds: ALT.CLOUDFLARE, pattern: 'direct' },
  { id: 'eval-direct-016', query: 'create grafana dashboard', expectedSkillId: SKILL.GRAFANA, acceptableSkillIds: ALT.GRAFANA, pattern: 'direct' },
  { id: 'eval-direct-017', query: 'lint rust code with clippy', expectedSkillId: SKILL.CLIPPY, pattern: 'direct' },
  { id: 'eval-direct-018', query: 'run database migrations with drizzle', expectedSkillId: SKILL.DRIZZLE_MIGRATE, pattern: 'direct' },

  // ──────────────────────────────────────────────────────────────────────────
  // PROBLEM Pattern — User describes a problem, not the solution
  // ──────────────────────────────────────────────────────────────────────────

  { id: 'eval-problem-001', query: 'make sure we are not shipping GPL code in proprietary product', expectedSkillId: SKILL.CARGO_DENY, acceptableSkillIds: [...ALT.LICENSE], pattern: 'problem' },
  { id: 'eval-problem-002', query: 'code formatting is inconsistent across the team', expectedSkillId: SKILL.PRETTIER, acceptableSkillIds: [SKILL.BIOME, ...ALT.TS_TOOLS, ...ALT.FORMATTERS, ...ALT.CODE_QUALITY], pattern: 'problem' },
  { id: 'eval-problem-003', query: 'catch common javascript bugs before runtime', expectedSkillId: SKILL.ESLINT, acceptableSkillIds: [...ALT.ESLINT, SKILL.BIOME, ...ALT.CODE_QUALITY], pattern: 'problem' },
  { id: 'eval-problem-004', query: 'production containers might have security issues', expectedSkillId: SKILL.TRIVY, acceptableSkillIds: ALT.TRIVY, pattern: 'problem' },
  { id: 'eval-problem-005', query: 'need to test database migrations without affecting production', expectedSkillId: SKILL.DOCKER_POSTGRES, acceptableSkillIds: [...ALT.POSTGRES, ...ALT.DB_MIGRATION], pattern: 'problem' },
  { id: 'eval-problem-006', query: 'documentation needs to be in PDF format for compliance', expectedSkillId: SKILL.PANDOC, acceptableSkillIds: [...ALT.PANDOC, ...ALT.MD_TO_PDF, ...ALT.DOC_CONVERTER], pattern: 'problem' },
  { id: 'eval-problem-007', query: 'api responses are too slow need to add caching', expectedSkillId: SKILL.REDIS, acceptableSkillIds: [...ALT.REDIS, ...ALT.CACHE], pattern: 'problem' },
  { id: 'eval-problem-008', query: 'our npm dependencies might have problematic licenses', expectedSkillId: SKILL.LICENSE_CHECKER, acceptableSkillIds: ALT.LICENSE, pattern: 'problem' },
  { id: 'eval-problem-009', query: 'code has security vulnerabilities we cannot find manually', expectedSkillId: SKILL.SEMGREP, acceptableSkillIds: [...ALT.SEMGREP, ...ALT.SECURITY_ANALYSIS, ...ALT.CODE_QUALITY], acceptableNamePatterns: ['semgrep', 'security', 'sast', 'code review', 'vulnerability', 'sonarqube'], pattern: 'problem' },
  { id: 'eval-problem-010', query: 'need to verify our APIs return correct responses after changes', expectedSkillId: SKILL.POSTMAN, acceptableSkillIds: ALT.POSTMAN, pattern: 'problem' },
  { id: 'eval-problem-011', query: 'cloud infrastructure is configured manually and drifting', expectedSkillId: SKILL.TERRAFORM, acceptableSkillIds: [...ALT.TERRAFORM, ...ALT.INFRA_AS_CODE], pattern: 'problem' },
  { id: 'eval-problem-012', query: 'we have no metrics to tell if our services are healthy or degraded', expectedSkillId: SKILL.PROMETHEUS, acceptableSkillIds: [...ALT.PROMETHEUS, ...ALT.GRAFANA, ...ALT.DATADOG, ...ALT.MONITORING], acceptableNamePatterns: ['prometheus', 'datadog', 'grafana', 'monitoring', 'metrics', 'observability'], pattern: 'problem' },
  { id: 'eval-problem-013', query: 'login flow breaks on different browsers after deployments', expectedSkillId: SKILL.PLAYWRIGHT, acceptableSkillIds: [...ALT.PLAYWRIGHT, ...ALT.BROWSER_DEBUG, ...ALT.FRONTEND_TESTING, ...ALT.CLOUD_DEPLOY], pattern: 'problem' },
  { id: 'eval-problem-014', query: 'our kubernetes pods keep crashing and need debugging', expectedSkillId: SKILL.KUBECTL, acceptableSkillIds: ALT.KUBECTL, pattern: 'problem' },
  { id: 'eval-problem-015', query: 'our python code style is inconsistent between developers', expectedSkillId: SKILL.BLACK, acceptableSkillIds: [SKILL.ESLINT, SKILL.BIOME, SKILL.PRETTIER, ...ALT.ESLINT, ...ALT.FORMATTERS, ...ALT.CODE_QUALITY], pattern: 'problem' },
  { id: 'eval-problem-016', query: 'commit messages are all over the place no consistency', expectedSkillId: SKILL.COMMITLINT, acceptableSkillIds: ALT.COMMITLINT, pattern: 'problem' },

  // ──────────────────────────────────────────────────────────────────────────
  // BUSINESS Pattern — Non-technical/PM language
  // ──────────────────────────────────────────────────────────────────────────

  { id: 'eval-business-001', query: 'ensure open source compliance for rust project', expectedSkillId: SKILL.CARGO_DENY, acceptableSkillIds: [...ALT.LICENSE], pattern: 'business' },
  { id: 'eval-business-002', query: 'maintain consistent code style across engineering team', expectedSkillId: SKILL.PRETTIER, pattern: 'business' },
  { id: 'eval-business-003', query: 'reduce bugs and improve code quality standards', expectedSkillId: SKILL.ESLINT, acceptableSkillIds: [...ALT.ESLINT, ...ALT.CODE_QUALITY, ...ALT.CODE_REVIEW, SKILL.BIOME], pattern: 'business' },
  { id: 'eval-business-004', query: 'meet security compliance requirements for container deployments', expectedSkillId: SKILL.TRIVY, acceptableSkillIds: ALT.TRIVY, pattern: 'business' },
  { id: 'eval-business-005', query: 'set up development environment for new engineers', expectedSkillId: SKILL.DOCKER_POSTGRES, acceptableSkillIds: [...ALT.POSTGRES, ...ALT.CLOUD_DEPLOY, ...ALT.INFRA_AS_CODE, ...ALT.DEV_ENVIRONMENT, SKILL.MYSQL, SKILL.MONGODB], pattern: 'business' },
  { id: 'eval-business-006', query: 'convert documentation to PDF and Word for client deliverables', expectedSkillId: SKILL.PANDOC, acceptableSkillIds: [...ALT.PANDOC, ...ALT.MD_TO_PDF, ...ALT.DOC_CONVERTER], pattern: 'business' },
  { id: 'eval-business-007', query: 'improve application performance and scalability', expectedSkillId: SKILL.REDIS, acceptableSkillIds: [...ALT.REDIS, ...ALT.K6], pattern: 'business' },
  { id: 'eval-business-008', query: 'enterprise license compliance scanning across all projects', expectedSkillId: SKILL.FOSSA, acceptableSkillIds: [...ALT.LICENSE, SKILL.LICENSE_CHECKER], pattern: 'business' },
  { id: 'eval-business-009', query: 'get visibility into application health and uptime', expectedSkillId: SKILL.DATADOG, acceptableSkillIds: [...ALT.DATADOG, ...ALT.PROMETHEUS, ...ALT.GRAFANA, ...ALT.MONITORING, SKILL.PROMETHEUS], acceptableNamePatterns: ['prometheus', 'datadog', 'grafana', 'new relic', 'observability', 'monitoring', 'opentelemetry'], pattern: 'business' },
  { id: 'eval-business-010', query: 'automate infrastructure provisioning for cloud migration', expectedSkillId: SKILL.TERRAFORM, acceptableSkillIds: [...ALT.TERRAFORM, ...ALT.INFRA_AS_CODE], pattern: 'business' },
  { id: 'eval-business-011', query: 'automate the release and versioning process', expectedSkillId: SKILL.SEMANTIC_RELEASE, acceptableSkillIds: ALT.SEMANTIC_RELEASE, pattern: 'business' },
  { id: 'eval-business-012', query: 'generate API documentation for partner integrations', expectedSkillId: SKILL.SWAGGER_CODEGEN, acceptableSkillIds: [...ALT.SWAGGER, ...ALT.API_DOCS, SKILL.TYPEDOC], acceptableNamePatterns: ['swagger', 'openapi', 'api doc', 'typedoc', 'redoc'], pattern: 'business' },
  { id: 'eval-business-013', query: 'keep all project dependencies secure and up to date', expectedSkillId: SKILL.DEPENDABOT, acceptableSkillIds: [...ALT.DEPENDABOT, ...ALT.SNYK, ...ALT.DEP_SECURITY, SKILL.CARGO_DENY], pattern: 'business' },
  { id: 'eval-business-014', query: 'ensure website works on all major browsers', expectedSkillId: SKILL.PLAYWRIGHT, acceptableSkillIds: [...ALT.PLAYWRIGHT, ...ALT.FRONTEND_TESTING, ...ALT.BROWSER_DEBUG, '8c794d32-17b0-476b-a4ab-3d6c0e9a2e03' /* CanIUse MCP (browser compat) */], acceptableNamePatterns: ['playwright', 'browserstack', 'caniuse', 'applitools', 'browser'], pattern: 'business' },

  // ──────────────────────────────────────────────────────────────────────────
  // ALTERNATE Pattern — Different terminology for same concept
  // ──────────────────────────────────────────────────────────────────────────

  { id: 'eval-alternate-001', query: 'cargo ban crate security advisory check', expectedSkillId: SKILL.CARGO_DENY, pattern: 'alternate' },
  { id: 'eval-alternate-002', query: 'beautify typescript code automatically', expectedSkillId: SKILL.PRETTIER, acceptableSkillIds: [SKILL.BIOME, ...ALT.TS_TOOLS, SKILL.TYPEDOC], pattern: 'alternate' },
  { id: 'eval-alternate-003', query: 'static analysis tool for javascript', expectedSkillId: SKILL.ESLINT, acceptableSkillIds: [...ALT.ESLINT, ...ALT.SEMGREP, ...ALT.SECURITY_ANALYSIS, ...ALT.CODE_QUALITY], pattern: 'alternate' },
  { id: 'eval-alternate-004', query: 'container image vulnerability scanner', expectedSkillId: SKILL.TRIVY, acceptableSkillIds: ALT.TRIVY, pattern: 'alternate' },
  { id: 'eval-alternate-005', query: 'postgresql container for development', expectedSkillId: SKILL.DOCKER_POSTGRES, acceptableSkillIds: ALT.POSTGRES, pattern: 'alternate' },
  { id: 'eval-alternate-006', query: 'document converter markup to portable format', expectedSkillId: SKILL.PANDOC, acceptableSkillIds: [...ALT.PANDOC, ...ALT.DOC_CONVERTER], pattern: 'alternate' },
  { id: 'eval-alternate-007', query: 'fast javascript typescript formatter linter combo', expectedSkillId: SKILL.BIOME, pattern: 'alternate' },
  { id: 'eval-alternate-008', query: 'SAST security scanning multi language', expectedSkillId: SKILL.SEMGREP, acceptableSkillIds: ALT.SEMGREP, pattern: 'alternate' },
  { id: 'eval-alternate-009', query: 'software composition analysis dependency checker', expectedSkillId: SKILL.SNYK, acceptableSkillIds: [...ALT.SNYK, ...ALT.DEPENDABOT, ...ALT.DEP_SECURITY], acceptableNamePatterns: ['snyk', 'dependency', 'sca', 'vulnerability', 'audit', 'sbom'], pattern: 'alternate' },
  { id: 'eval-alternate-010', query: 'IaC cloud provisioning declarative', expectedSkillId: SKILL.TERRAFORM, acceptableSkillIds: [...ALT.TERRAFORM, ...ALT.INFRA_AS_CODE, ...ALT.CLOUD_DEPLOY], pattern: 'alternate' },
  { id: 'eval-alternate-011', query: 'k8s cluster management deploy pods', expectedSkillId: SKILL.KUBECTL, acceptableSkillIds: ALT.KUBECTL, pattern: 'alternate' },
  { id: 'eval-alternate-012', query: 'HTTP request testing command line tool', expectedSkillId: SKILL.HTTPIE, acceptableSkillIds: ALT.API_TESTING, pattern: 'alternate' },
  { id: 'eval-alternate-013', query: 'application performance monitoring distributed tracing', expectedSkillId: SKILL.DATADOG, acceptableSkillIds: [...ALT.DATADOG, ...ALT.PROMETHEUS, ...ALT.MONITORING], pattern: 'alternate' },
  { id: 'eval-alternate-014', query: 'nosql document database for development', expectedSkillId: SKILL.MONGODB, acceptableSkillIds: ALT.MONGODB, pattern: 'alternate' },

  // ──────────────────────────────────────────────────────────────────────────
  // COMPOSITION Pattern — Part of a larger workflow
  // ──────────────────────────────────────────────────────────────────────────

  { id: 'eval-composition-001', query: 'rust supply chain security audit pipeline', expectedSkillId: SKILL.CARGO_DENY, pattern: 'composition' },
  { id: 'eval-composition-002', query: 'pre-commit hook to format and lint code', expectedSkillId: SKILL.GIT_HOOKS, acceptableSkillIds: [SKILL.COMMITLINT, ...ALT.COMMITLINT, SKILL.PRETTIER, SKILL.ESLINT, SKILL.BIOME, ...ALT.CODE_QUALITY, ...ALT.FORMATTERS, '4451c98e-6156-478a-8ffc-b2267b216335', /* ruchy-mcp (lint/format/analysis) */ 'eeb14657-6240-4c2f-884e-14ac026ee28c' /* Nm Attune Precommit Setup */], pattern: 'composition' },
  { id: 'eval-composition-003', query: 'ci pipeline to validate code quality', expectedSkillId: SKILL.ESLINT, acceptableSkillIds: [...ALT.ESLINT, ...ALT.CODE_QUALITY, SKILL.BIOME], pattern: 'composition' },
  { id: 'eval-composition-004', query: 'container security scanning in deployment workflow', expectedSkillId: SKILL.TRIVY, acceptableSkillIds: [...ALT.TRIVY, ...ALT.CONTAINER_SCANNING, SKILL.HADOLINT], pattern: 'composition' },
  { id: 'eval-composition-005', query: 'spin up a postgres container for integration test fixtures', expectedSkillId: SKILL.DOCKER_POSTGRES, acceptableSkillIds: ALT.POSTGRES, pattern: 'composition' },
  { id: 'eval-composition-006', query: 'convert markdown docs to PDF as part of release pipeline', expectedSkillId: SKILL.PANDOC, acceptableSkillIds: ALT.PANDOC, pattern: 'composition' },
  { id: 'eval-composition-007', query: 'deploy infrastructure then deploy application on top', expectedSkillId: SKILL.TERRAFORM, acceptableSkillIds: [...ALT.TERRAFORM, ...ALT.INFRA_AS_CODE, ...ALT.CLOUD_DEPLOY], pattern: 'composition' },
  { id: 'eval-composition-008', query: 'set up monitoring stack with metrics and dashboards', expectedSkillId: SKILL.PROMETHEUS, acceptableSkillIds: [...ALT.PROMETHEUS, ...ALT.GRAFANA, ...ALT.MONITORING], pattern: 'composition' },
  { id: 'eval-composition-009', query: 'automated release pipeline with version bump and changelog', expectedSkillId: SKILL.SEMANTIC_RELEASE, acceptableSkillIds: ALT.SEMANTIC_RELEASE, pattern: 'composition' },
  { id: 'eval-composition-010', query: 'end to end testing pipeline with cross browser verification', expectedSkillId: SKILL.PLAYWRIGHT, acceptableSkillIds: [...ALT.PLAYWRIGHT, ...ALT.BROWSER_DEBUG, ...ALT.FRONTEND_TESTING], pattern: 'composition' },

  // ──────────────────────────────────────────────────────────────────────────
  // DISAMBIGUATION — Queries where multiple skills could match
  // Tests whether the search picks the most relevant one
  // ──────────────────────────────────────────────────────────────────────────

  { id: 'eval-disambig-001', query: 'check my code for issues', expectedSkillId: SKILL.ESLINT, acceptableSkillIds: [...ALT.ESLINT, ...ALT.CODE_QUALITY, SKILL.BIOME], pattern: 'direct' },
  { id: 'eval-disambig-002', query: 'static analysis to find security problems in my source code', expectedSkillId: SKILL.SEMGREP, acceptableSkillIds: [...ALT.SEMGREP, SKILL.CODEQL, ...ALT.SECURITY_ANALYSIS], pattern: 'direct' },
  { id: 'eval-disambig-003', query: 'code formatter for my project', expectedSkillId: SKILL.PRETTIER, acceptableSkillIds: [SKILL.BIOME, SKILL.BLACK, ...ALT.TS_TOOLS, ...ALT.FORMATTERS, ...ALT.CODE_QUALITY, ...ALT.ESLINT], pattern: 'direct' },
  { id: 'eval-disambig-004', query: 'check dependency vulnerabilities', expectedSkillId: SKILL.SNYK, acceptableSkillIds: [...ALT.SNYK, ...ALT.DEP_SECURITY, ...ALT.DEPENDABOT, ...ALT.SECURITY_ANALYSIS], pattern: 'direct' },
  { id: 'eval-disambig-005', query: 'lint my dockerfile', expectedSkillId: SKILL.HADOLINT, acceptableSkillIds: [SKILL.DOCKERFILE_LINT], pattern: 'direct' },
  { id: 'eval-disambig-006', query: 'test my API endpoints', expectedSkillId: SKILL.POSTMAN, acceptableSkillIds: [...ALT.POSTMAN, ...ALT.API_TESTING], pattern: 'direct' },
  { id: 'eval-disambig-007', query: 'run a local database for testing', expectedSkillId: SKILL.DOCKER_POSTGRES, acceptableSkillIds: ALT.POSTGRES, pattern: 'direct' },
  { id: 'eval-disambig-008', query: 'set up application monitoring', expectedSkillId: SKILL.PROMETHEUS, acceptableSkillIds: [...ALT.PROMETHEUS, ...ALT.GRAFANA, ...ALT.DATADOG, ...ALT.MONITORING], acceptableNamePatterns: ['prometheus', 'datadog', 'grafana', 'graylog', 'monitoring', 'observability'], pattern: 'direct' },
  { id: 'eval-disambig-009', query: 'check for license compliance issues', expectedSkillId: SKILL.FOSSA, acceptableSkillIds: [...ALT.LICENSE, SKILL.LICENSE_CHECKER], pattern: 'direct' },
  { id: 'eval-disambig-010', query: 'generate TypeScript documentation', expectedSkillId: SKILL.TYPEDOC, pattern: 'direct' },
  { id: 'eval-disambig-011', query: 'load test my service', expectedSkillId: SKILL.K6, acceptableSkillIds: ALT.K6, pattern: 'direct' },
  { id: 'eval-disambig-012', query: 'deploy my application to the cloud', expectedSkillId: SKILL.CLOUDFLARE_DEPLOY, acceptableSkillIds: [...ALT.CLOUDFLARE, ...ALT.CLOUD_DEPLOY], pattern: 'direct' },
  { id: 'eval-disambig-013', query: 'run tests for my react components', expectedSkillId: SKILL.JEST, acceptableSkillIds: [...ALT.JEST, ...ALT.FRONTEND_TESTING], pattern: 'direct' },
  { id: 'eval-disambig-014', query: 'document my UI components', expectedSkillId: SKILL.STORYBOOK, acceptableSkillIds: [...ALT.STORYBOOK, ...ALT.UI_COMPONENTS], pattern: 'direct' },
  { id: 'eval-disambig-015', query: 'analyze code for security vulnerabilities using queries', expectedSkillId: SKILL.CODEQL, acceptableSkillIds: [...ALT.CODEQL, ...ALT.SEMGREP, ...ALT.SECURITY_ANALYSIS], pattern: 'direct' },

  // ──────────────────────────────────────────────────────────────────────────
  // HARDENING — Targeted fixtures for previously weak areas
  // ──────────────────────────────────────────────────────────────────────────

  { id: 'eval-hardening-001', query: 'javascript linter to enforce coding standards', expectedSkillId: SKILL.ESLINT, acceptableSkillIds: [...ALT.ESLINT, SKILL.BIOME, ...ALT.CODE_QUALITY], pattern: 'direct' },
  { id: 'eval-hardening-002', query: 'collect application metrics and set up alerting', expectedSkillId: SKILL.PROMETHEUS, acceptableSkillIds: [...ALT.PROMETHEUS, ...ALT.DATADOG, ...ALT.MONITORING], pattern: 'problem' },
  { id: 'eval-hardening-003', query: 'scan npm packages for known security vulnerabilities', expectedSkillId: SKILL.SNYK, acceptableSkillIds: [...ALT.SNYK, ...ALT.DEP_SECURITY, ...ALT.DEPENDABOT, '926d5d00-f4ba-47c6-a160-2f9ebc08fdb6' /* io.github.rog0x/npm */, 'f81f230d-3d61-42c8-a246-edc1f5c633ac' /* io.github.alisaitteke/npm-mcp */], pattern: 'direct' },
  { id: 'eval-hardening-004', query: 'run end to end browser tests for web application', expectedSkillId: SKILL.PLAYWRIGHT, acceptableSkillIds: [...ALT.PLAYWRIGHT, ...ALT.BROWSER_DEBUG, ...ALT.FRONTEND_TESTING], pattern: 'direct' },
];

// ══════════════════════════════════════════════════════════════════════════════
// Fixture Validation
// ══════════════════════════════════════════════════════════════════════════════

export function validateFixtures(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check minimum count (Phase 2: 80+)
  if (evalFixtures.length < 80) {
    errors.push(
      `Expected at least 80 fixtures, got ${evalFixtures.length}`
    );
  }

  // Check pattern distribution
  const patternCounts: Record<string, number> = {
    direct: 0,
    problem: 0,
    business: 0,
    alternate: 0,
    composition: 0,
  };

  for (const fixture of evalFixtures) {
    patternCounts[fixture.pattern]++;
  }

  for (const [pattern, count] of Object.entries(patternCounts)) {
    if (count === 0) {
      errors.push(`Missing fixtures for pattern: ${pattern}`);
    }
    if (count < 5) {
      errors.push(`Too few fixtures for pattern ${pattern}: ${count} (min 5)`);
    }
  }

  // Check for duplicate IDs
  const ids = new Set<string>();
  for (const fixture of evalFixtures) {
    if (ids.has(fixture.id)) {
      errors.push(`Duplicate fixture ID: ${fixture.id}`);
    }
    ids.add(fixture.id);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Fixture Stats
// ══════════════════════════════════════════════════════════════════════════════

export function getFixtureStats() {
  const patternCounts: Record<string, number> = {
    direct: 0,
    problem: 0,
    business: 0,
    alternate: 0,
    composition: 0,
  };

  const skillCounts: Record<string, number> = {};

  for (const fixture of evalFixtures) {
    patternCounts[fixture.pattern]++;

    if (!skillCounts[fixture.expectedSkillId]) {
      skillCounts[fixture.expectedSkillId] = 0;
    }
    skillCounts[fixture.expectedSkillId]++;
  }

  return {
    total: evalFixtures.length,
    byPattern: patternCounts,
    uniqueSkills: Object.keys(skillCounts).length,
    bySkill: skillCounts,
  };
}
