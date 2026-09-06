import jwt from "jsonwebtoken";
import { env } from "../config/env";

export class TokenVerificationError extends Error {
  constructor(
    public readonly code:
      | "TOKEN_MISSING"
      | "TOKEN_MALFORMED"
      | "TOKEN_EXPIRED"
      | "TOKEN_INVALID"
      | "WRONG_TOKEN_TYPE",
    message: string
  ) {
    super(message);
    this.name = "TokenVerificationError";
  }
}

export type AccessTokenPayload = {
  sub: string;
  scopes: string[];
  email?: string;
};

export function verifyAccessToken(token: string): AccessTokenPayload {
  let payload: Record<string, unknown> | undefined;

  const keys = [env.JWT_SECRET, ...env.OLD_JWT_SECRETS.split(",").map((k) => k.trim()).filter(Boolean)];
  let lastErr: unknown;
  for (const key of keys) {
    try {
      payload = jwt.verify(token, key, {
        algorithms: ["HS256"],
        issuer: env.AUTH_ISSUER
      }) as Record<string, unknown>;
      break;
    } catch (err) {
      lastErr = err;
      if (err instanceof jwt.TokenExpiredError) {
        throw new TokenVerificationError("TOKEN_EXPIRED", "Access token expired");
      }
    }
  }

  if (!payload) {
    throw new TokenVerificationError(
      "TOKEN_INVALID",
      lastErr instanceof jwt.JsonWebTokenError ? "Invalid access token" : "Access token could not be verified"
    );
  }

  if (payload.type !== "access") {
    throw new TokenVerificationError("WRONG_TOKEN_TYPE", "Only access tokens are accepted");
  }

  if (typeof payload.sub !== "string" || !Array.isArray(payload.scopes)) {
    throw new TokenVerificationError("TOKEN_INVALID", "Malformed token payload");
  }

  return {
    sub: payload.sub,
    scopes: payload.scopes,
    email: typeof payload.email === "string" ? payload.email : undefined
  };
}
