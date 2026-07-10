import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/contracts',
  'packages/schema',
  'packages/dag',
  'packages/domain',
  'packages/mcp',
  'packages/eval',
  'apps/local',
  'apps/local/web',
]);
