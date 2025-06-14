// @ts-check

import {
  assertEnvironment,
  moduleExport
} from '@-xun/symbiote/assets/eslint.config.mjs';

import { createDebugLogger } from 'rejoinder';

const debug = createDebugLogger({ namespace: 'symbiote:config:eslint' });

const config = await moduleExport({
  derivedAliases: getEslintAliases(),
  ...(await assertEnvironment())
});

config.push({
  /* Add custom config here, such as disabling certain rules */
});

export default config;

debug('exported config: %O', config);

function getEslintAliases() {
  // ! These aliases are auto-generated by symbiote. Instead of modifying them
  // ! directly, consider regenerating aliases across the entire project with:
  // ! `npx symbiote project renovate --regenerate-assets --assets-preset ...`
  return [
    ['multiverse+next-api:*', './packages/next-api/src/*'],
    ['multiverse+next-api-common:*', './packages/next-api-common/src/*'],
    ['multiverse+next-env:*', './packages/next-env/src/*'],
    ['multiverse+shared:*', './packages/shared/src/*'],
    ['multiverse+next-api', './packages/next-api/src/index.ts'],
    ['multiverse+next-api-common', './packages/next-api-common/src/index.ts'],
    ['multiverse+next-env', './packages/next-env/src/index.ts'],
    ['multiverse+shared', './packages/shared/src/index.ts'],
    ['rootverse+next-api:*', './packages/next-api/*'],
    ['rootverse+next-api-common:*', './packages/next-api-common/*'],
    ['rootverse+next-env:*', './packages/next-env/*'],
    ['rootverse+shared:*', './packages/shared/*'],
    ['rootverse:*', './*'],
    ['universe+next-api:*', './packages/next-api/src/*'],
    ['universe+next-api-common:*', './packages/next-api-common/src/*'],
    ['universe+next-env:*', './packages/next-env/src/*'],
    ['universe+shared:*', './packages/shared/src/*'],
    ['universe+next-api', './packages/next-api/src/index.ts'],
    ['universe+next-api-common', './packages/next-api-common/src/index.ts'],
    ['universe+next-env', './packages/next-env/src/index.ts'],
    ['universe+shared', './packages/shared/src/index.ts'],
    ['universe:*', './src/*'],
    ['universe', './src/index.ts'],
    ['testverse+next-api:*', './packages/next-api/test/*'],
    ['testverse+next-api-common:*', './packages/next-api-common/test/*'],
    ['testverse+next-env:*', './packages/next-env/test/*'],
    ['testverse+shared:*', './packages/shared/test/*'],
    ['testverse:*', './test/*'],
    ['typeverse:*', './types/*']
  ];
}
