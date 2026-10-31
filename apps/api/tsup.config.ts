import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/worker.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [
    "@brightloop/shared",
    "@brightloop/db",
    "@brightloop/billing",
    "@brightloop/metering",
    "@brightloop/integrations",
  ],
});
