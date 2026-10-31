import { connectDb, disconnectDb } from "@brightloop/db";
import type { AppConfig } from "../config/env.js";

export async function startDatabase(config: AppConfig) {
  let memoryServer: { getUri(): string; stop(): Promise<boolean> } | null = null;
  let uri = config.MONGODB_URI;
  if (config.USE_MEMORY_DB) {
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    const server = await MongoMemoryServer.create({
      instance: { dbName: config.MONGODB_DB ?? "brightloop" },
    });
    memoryServer = server;
    uri = server.getUri();
  }
  await connectDb({ uri, dbName: config.MONGODB_DB ?? "brightloop" });
  return {
    uri,
    async stop() {
      await disconnectDb();
      if (memoryServer) await memoryServer.stop();
    },
  };
}
