const fs = require('fs');
const path = require('path');

// Get the environment argument, defaulting to "development"
const env = process.env.BUILD_ENV || 'dev'; // Options: development, stg, production

// Define the corresponding environment file
const envFile = `.env.${env}`;
const targetFile = path.join(__dirname, '.env');

// A required var every deployed build needs, used only to sanity-check that config
// actually reached the build one way or another — not an exhaustive list.
const SENTINEL_VAR = 'VITE_BLOCKS_API_URL';

if (fs.existsSync(envFile)) {
  // Local/legacy path: an .env.<env> file is present (e.g. a developer's own checkout,
  // or a repo that still tracks it) — copy it to `.env` as before.
  fs.copyFileSync(envFile, targetFile);
  console.log(`✅ Successfully set environment: ${envFile} → .env`);
} else if (process.env[SENTINEL_VAR]) {
  // Deployment path: `.env.<env>` is gitignored (only `.env.example` is tracked), so a
  // fresh checkout never has it. The deployment platform instead injects VITE_BLOCKS_*
  // as real process env vars (Key Vault-backed) — Vite's `loadEnv` already merges those
  // into `import.meta.env` on its own, with no `.env` file needed, so there is nothing
  // for this script to copy. Skip, rather than fail a build that has everything it needs.
  console.log(`ℹ️  ${envFile} not found, but ${SENTINEL_VAR} is set in the environment — ` +
    'relying on injected env vars (Vite reads process.env directly); skipping file copy.');
} else {
  console.error(
    `❌ Error: ${envFile} does not exist, and ${SENTINEL_VAR} is not set in the environment.\n` +
    '   Either commit/provide an env file for this build, or supply the VITE_BLOCKS_* ' +
    'variables directly (e.g. via the deployment platform\'s environment-variable settings).'
  );
  process.exit(1);
}
