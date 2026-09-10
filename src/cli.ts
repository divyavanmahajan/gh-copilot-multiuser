import { loadConfig } from "./config.js";
import { startServer } from "./server/index.js";

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
