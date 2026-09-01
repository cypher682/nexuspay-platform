import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { HttpError } from "./error-handler";

export function requireInternalApiKey(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const provided = req.headers["x-internal-api-key"];
  if (typeof provided !== "string" || provided.length === 0) {
    next(new HttpError(401, "Missing X-Internal-Api-Key header"));
    return;
  }

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(env.INTERNAL_API_KEY, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    next(new HttpError(401, "Invalid internal API key"));
    return;
  }

  next();
}
