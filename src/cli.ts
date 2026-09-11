import { existsSync } from "node:fs";
import path from "node:path";

import { loadConfig } from "./config.js";
import { startServer } from "./server/index.js";

// Load a .env file before the config reads process.env, so secrets can live in
// a gitignored file instead of a shell history. Real environment variables win,
// matching node's own --env-file. COPILOT_ROOM_ENV_FILE points elsewhere; set it
// to an empty string to skip the file entirely.
const envFile = process.env.COPILOT_ROOM_ENV_FILE ?? ".env";
if (envFile && existsSync(envFile)) {
  process.loadEnvFile(path.resolve(envFile));
}

const config = loadConfig();

startServer(config)
  .then(({ url, guestCode }) => {
    console.log(`copilot-room listening on ${url} (repo: ${config.repo}, mode: ${config.mode})`);
    if (guestCode) console.log(`guest join code: ${guestCode}`);
  })
  .catch((err: unknown) => {
    console.error("copilot-room failed to start:", err);
    process.exit(1);
  });
