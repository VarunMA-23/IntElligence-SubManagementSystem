import type { NextFunction, Request, RequestHandler, Response } from "express";

export function pageMeta(page: number, perPage: number, total: number) {
  return {
    page,
    per_page: perPage,
    total,
    total_pages: perPage ? Math.ceil(total / perPage) : 0,
  };
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sortFromQuery(value: string | undefined, allowed: string[], fallback: string) {
  if (!value) return fallback;
  const [field, direction] = value.split(".");
  const mapped = allowed.includes(field ?? "") ? field : null;
  if (!mapped) return fallback;
  return { [mapped]: direction === "asc" ? 1 : -1 } as Record<string, 1 | -1>;
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
