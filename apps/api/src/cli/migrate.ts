import mongoose from "mongoose";
import { loadConfig } from "../config/env.js";
import { startDatabase } from "../lib/database.js";

const config = loadConfig();
const database = await startDatabase(config);

try {
  const models = Object.values(mongoose.models);
  for (const model of models) {
    try {
      await model.createCollection();
      await model.syncIndexes();
      console.log(`ready ${model.modelName}`);
    } catch (error) {
      console.error(`failed ${model.modelName}: ${(error as Error).message}`);
      throw error;
    }
  }
  console.log(`BrightLoop migrations complete (${models.length} collections)`);
} finally {
  await database.stop();
  await mongoose.disconnect().catch(() => undefined);
}
