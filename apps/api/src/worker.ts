import { loadConfig } from "./config/env.js";
import { startDatabase } from "./lib/database.js";
import { createLogger } from "./lib/logger.js";
import { dispatchOutbox, processWebhookDeliveries } from "./services/webhook-service.js";

const config = loadConfig();
const logger = createLogger(config);
const database = await startDatabase(config);
let running = true;

async function tick() {
  if (!running) return;
  try {
    const outbox = await dispatchOutbox(config);
    const deliveries = await processWebhookDeliveries(config);
    if (outbox || deliveries) logger.info("worker.tick", { outbox, deliveries });
  } catch (error) {
    logger.error("worker.tick_failed", { error: (error as Error).message });
  }
  setTimeout(() => void tick(), config.WORKER_POLL_MS).unref();
}

logger.info("worker.started", { poll_ms: config.WORKER_POLL_MS });
void tick();

async function shutdown(signal: string) {
  logger.info("worker.stopping", { signal });
  running = false;
  await database.stop();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
