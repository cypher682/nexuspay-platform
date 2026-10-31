import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface AccessTokenClaims {
  sub: string;
  type: "access";
  email: string;
  scopes: string[];
  iss: string;
}

export type TokenPayload = { sub: string; type: string; scopes?: string[]; iss: string };

const issuer = env.MFA_ISSUER;

export function decodeToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET, {
      algorithms: [env.JWT_ALGORITHM],
      issuer
    }) as TokenPayload;
  } catch (err) {
    const oldKeys = env.OLD_JWT_SECRETS.split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    for (const key of oldKeys) {
      try {
        return jwt.verify(token, key, {
          algorithms: [env.JWT_ALGORITHM],
          issuer
        }) as TokenPayload;
      } catch {
        // try next rotated key
      }
    }
    throw err;
  }
}
