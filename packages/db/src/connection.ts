import dns from "node:dns";
import mongoose from "mongoose";

// On Windows, Node's default DNS resolver blocks SRV record lookups needed
// for mongodb+srv:// URIs. Switching to Google's public DNS fixes this.
if (process.platform === "win32") {
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
}

export interface ConnectOptions {
  uri: string;
  dbName?: string;
}

export async function connectDb({ uri, dbName }: ConnectOptions): Promise<typeof mongoose> {
  mongoose.set("strictQuery", true);
  if (mongoose.connection.readyState === 1) return mongoose;
  await mongoose.connect(uri, {
    dbName,
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
  });
  return mongoose;
}

export async function disconnectDb(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

export function dbState(): string {
  switch (mongoose.connection.readyState) {
    case 0:
      return "down";
    case 1:
      return "up";
    case 2:
      return "connecting";
    case 3:
      return "disconnecting";
    default:
      return "unknown";
  }
}

export async function pingDb(): Promise<boolean> {
  if (mongoose.connection.readyState !== 1) return false;
  try {
    await mongoose.connection.db?.admin().ping();
    return true;
  } catch {
    return false;
  }
}
