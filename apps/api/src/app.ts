import express from "express";
import mongoose from "mongoose";
import type { AppConfig } from "./config/env.js";
import { createLogger } from "./lib/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/logger.js";
import { createRateLimiter } from "./middleware/rate-limit.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { securityMiddleware } from "./middleware/security.js";
import { apiV1Routes, privateInternalRoutes } from "./routes/index.js";

export function createApp(config: AppConfig) {
  const app = express();
  const logger = createLogger(config);

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(requestIdMiddleware);
  app.use(requestLogger(logger));
  app.use(...securityMiddleware(config));
  app.use(
    express.json({
      limit: "10mb",
      verify(req, _res, buffer) {
        (req as express.Request).rawBodyText = buffer.toString("utf8");
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use(
    createRateLimiter({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      max: config.RATE_LIMIT_MAX,
    }),
  );

  app.get("/health", (_req, res) => {
    const states = ["disconnected", "connected", "connecting", "disconnecting"];
    res.json({
      status: mongoose.connection.readyState === 1 ? "ok" : "degraded",
      service: "brightloop-api",
      database: states[mongoose.connection.readyState] ?? "unknown",
      timestamp: new Date().toISOString(),
    });
  });

  app.use("/api/v1/internal", privateInternalRoutes(config));
  app.use("/api/v1", apiV1Routes(config));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
