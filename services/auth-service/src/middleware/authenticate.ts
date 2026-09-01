import type { NextFunction, Request, Response } from "express";
import { decodeToken } from "../lib/tokens";
import { HttpError } from "./error-handler";

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
    req.auth = { userId: payload.sub, scopes: payload.scopes };
    next();
  } catch {
    next(new HttpError(401, "Invalid or expired token"));
  }
}

export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next();
    return;
  }

  try {
    const payload = decodeToken(header.slice("Bearer ".length));
    if (payload.type === "access") {
      req.auth = { userId: payload.sub, scopes: payload.scopes };
    }
  } catch {
    /* unauthenticated requests fall through to route-level checks */
  }
  next();
}
