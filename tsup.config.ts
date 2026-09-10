import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: false,
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
  // The SDK spawns a native runtime; never bundle it.
  external: ["@github/copilot-sdk"],
});
