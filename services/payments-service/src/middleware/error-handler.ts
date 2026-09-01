import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../lib/logger";

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: "not_found", message: "Route not found", requestId: req.requestId });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      error: "request_failed",
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
      requestId: req.requestId
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(422).json({
      error: "validation_error",
      message: "Request validation failed",
      details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      requestId: req.requestId
    });
    return;
  }

  logger.error("Unhandled error", {
    path: req.path,
    method: req.method,
    requestId: req.requestId,
    error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err)
  });

  res.status(500).json({
    error: "internal_error",
    message: "An unexpected error occurred",
    requestId: req.requestId
  });
}
