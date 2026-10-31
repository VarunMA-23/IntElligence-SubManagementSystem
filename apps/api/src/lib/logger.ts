import type { AppConfig } from "../config/env.js";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export function createLogger(config: Pick<AppConfig, "LOG_LEVEL">, base: Record<string, unknown> = {}): Logger {
  const threshold = ORDER[config.LOG_LEVEL] ?? 20;
  const write = (level: Level, message: string, meta?: Record<string, unknown>) => {
    if (ORDER[level] < threshold) return;
    const entry = {
      level,
      time: new Date().toISOString(),
      message,
      ...base,
      ...(meta ?? {}),
    };
    const line = JSON.stringify(entry);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
  };
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
