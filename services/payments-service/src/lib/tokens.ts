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
  let payload: Record<string, unknown>;

  try {
    payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: env.AUTH_ISSUER
    }) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new TokenVerificationError("TOKEN_EXPIRED", "Access token expired");
    }
    throw new TokenVerificationError("TOKEN_INVALID", "Invalid access token");
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
