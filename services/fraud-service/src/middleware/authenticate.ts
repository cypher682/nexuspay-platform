import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { decodeToken } from "../lib/tokens";
import { HttpError } from "./error-handler";
import { env } from "../config/env";

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next(new HttpError(401, "Missing bearer token"));
    return;
  }

  try {
    const payload = decodeToken(header.slice("Bearer ".length));
    if (payload.type !== "access") {
      next(new HttpError(401, "Invalid token type"));
      return;
    }
    req.auth = { userId: payload.sub, scopes: payload.scopes ?? [] };
    next();
  } catch {
    next(new HttpError(401, "Invalid or expired token"));
  }
}

export function requireFraudAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(new HttpError(401, "Authentication required"));
    return;
  }
  const { scopes } = req.auth;
  if (scopes.includes("*") || scopes.includes("fraud:admin")) {
    next();
    return;
  }
  next(new HttpError(403, "Missing required permission: fraud:admin"));
}

export function requireInternalKey(req: Request, _res: Response, next: NextFunction): void {
  const provided = req.headers["x-internal-api-key"];
  if (typeof provided !== "string" || provided.length === 0) {
    next(new HttpError(401, "Missing internal API key"));
    return;
  }

  const expected = Buffer.from(env.INTERNAL_API_KEY);
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    next(new HttpError(401, "Invalid internal API key"));
    return;
  }

  next();
}
