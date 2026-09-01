import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./error-handler";
import { TokenVerificationError, verifyAccessToken } from "../lib/tokens";

function extractBearerToken(req: Request): string {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing bearer token");
  }
  const token = header.slice("Bearer ".length).trim();
  if (token.length === 0) {
    throw new HttpError(401, "Missing bearer token");
  }
  return token;
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  try {
    const payload = verifyAccessToken(extractBearerToken(req));
    req.auth = { userId: payload.sub, scopes: payload.scopes };
    next();
  } catch (err) {
    if (err instanceof TokenVerificationError) {
      next(new HttpError(401, err.message));
      return;
    }
    next(err);
  }
}

export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    next();
    return;
  }
  try {
    const payload = verifyAccessToken(header.slice("Bearer ".length).trim());
    req.auth = { userId: payload.sub, scopes: payload.scopes };
    next();
  } catch (err) {
    if (err instanceof TokenVerificationError) {
      next(new HttpError(401, err.message));
      return;
    }
    next(err);
  }
}
