import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { startDatabase } from "./lib/database.js";
import { createLogger } from "./lib/logger.js";

const config = loadConfig();
const logger = createLogger(config);
const database = await startDatabase(config);
const app = createApp(config);

const server = app.listen(config.PORT, () => {
  logger.info("server.started", {
    port: config.PORT,
    environment: config.NODE_ENV,
    database: config.USE_MEMORY_DB ? "memory" : "configured",
  });
});

async function shutdown(signal: string) {
  logger.info("server.stopping", { signal });
  server.close(async () => {
    await database.stop();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
