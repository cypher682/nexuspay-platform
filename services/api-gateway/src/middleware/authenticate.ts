import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { verifyAccessToken } from "../lib/tokens";

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({
      error: "request_failed",
      message: "Missing bearer token",
      requestId: req.requestId
    });
    return;
  }

  try {
    const claims = verifyAccessToken(header.slice("Bearer ".length));
    if (claims.type !== "access") {
      throw new Error(`Unexpected token type: ${claims.type}`);
    }
    req.auth = { userId: claims.sub, scopes: claims.scopes ?? [] };
    next();
  } catch (err) {
    const reason = err instanceof jwt.TokenExpiredError
      ? "expired"
      : err instanceof Error ? err.message : "invalid";
    res.status(401).json({
      error: "request_failed",
      message: "Invalid access token",
      requestId: req.requestId,
      details: [{ field: "authorization", issue: reason }]
    });
  }
}
