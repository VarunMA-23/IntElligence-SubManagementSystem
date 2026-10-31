import mongoose, { type ClientSession } from "mongoose";

let supportsTransactions: boolean | null = null;

async function detectTransactions(): Promise<boolean> {
  if (supportsTransactions !== null) return supportsTransactions;
  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) return false;
    const hello = await admin.command({ hello: 1 });
    supportsTransactions = Boolean(hello.setName) || hello.msg === "isdbgrid";
  } catch {
    supportsTransactions = false;
  }
  return supportsTransactions;
}

export async function withTransaction<T>(fn: (session?: ClientSession) => Promise<T>): Promise<T> {
  const supported = await detectTransactions();
  if (!supported) return fn(undefined);
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
