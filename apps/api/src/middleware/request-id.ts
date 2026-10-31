import type { NextFunction, Request, Response } from "express";
import { newId } from "@brightloop/shared";

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("x-request-id");
  req.requestId = incoming && incoming.length <= 128 ? incoming : newId();
  res.setHeader("X-Request-Id", req.requestId);
  next();
}
